"""Private, single-worker FFmpeg service. Python 3.11+, FFmpeg/ffprobe required."""
import hashlib
import hmac
import json
import os
import re
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

PRESETS = {"high": (1080, 21, "160k"), "standard": (720, 25, "128k"),
           "economy": (480, 29, "96k"), "original": (720, 25, "128k")}
MAX_BYTES = 64 * 1024 * 1024
MAX_SECONDS = 600


def run(args, timeout=900):
    # No shell, no user-supplied URL, no network protocols or playlist demuxers.
    result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise ValueError("文件无法解码或转码失败，请检查视频格式。")
    return result.stdout


def probe(path):
    data = json.loads(run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
                          "-format_whitelist", "mov,matroska,avi,flv,mpeg,mpegts,ogg",
                          "-show_streams", "-show_format", "-of", "json", str(path)], 30))
    streams = data.get("streams", [])
    videos = [s for s in streams if s.get("codec_type") == "video"
              and not s.get("disposition", {}).get("attached_pic")]
    if not videos:
        raise ValueError("未检测到视频轨道。")
    video = videos[0]
    duration = float(data.get("format", {}).get("duration", 0))
    width, height = int(video.get("width", 0)), int(video.get("height", 0))
    if not 0 < duration <= MAX_SECONDS or not 0 < width <= 7680 or not 0 < height <= 7680:
        raise ValueError("视频限 10 分钟、每边最多 7680 像素。")
    if width * height > 34_000_000:
        raise ValueError("视频分辨率过高。")
    return {"width": width, "height": height, "duration": duration,
            "videoIndex": video["index"], "codec": video.get("codec_name"),
            "pixelFormat": video.get("pix_fmt"),
            "audio": any(s.get("codec_type") == "audio" for s in streams),
            "audioCodecs": [s.get("codec_name") for s in streams if s.get("codec_type") == "audio"]}


def transcode(directory, preset, keep):
    keep = keep or preset == "original"
    source = directory / "source"
    original = probe(source)
    height, crf, audio = PRESETS[preset]
    playback, poster = directory / "playback.mp4", directory / "poster.jpg"
    with source.open("rb") as stream:
        header = stream.read(16)
    use_original = (preset == "original" and header[4:8] == b"ftyp"
                    and header[8:12] in [b"isom", b"iso2", b"mp41", b"mp42", b"avc1"]
                    and original["codec"] == "h264" and original["pixelFormat"] == "yuv420p"
                    and all(c == "aac" for c in original["audioCodecs"]))
    if use_original:
        playback.unlink(missing_ok=True)
        os.link(source, playback)  # Two private references, one unchanged stored file.
    else:
        run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-threads", "2", "-filter_threads", "2",
         "-protocol_whitelist", "file,pipe", "-format_whitelist",
         "mov,matroska,avi,flv,mpeg,mpegts,ogg", "-i", str(source),
         "-map", f"0:{original['videoIndex']}", "-map", "0:a:0?",
         "-vf", f"scale=w='min(iw,{height * 16 // 9})':h='min(ih,{height})':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
         "-c:v", "libx264", "-threads", "2", "-preset", "medium", "-crf", str(crf),
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", audio,
         "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart",
             "-fs", str(256 * 1024 * 1024), str(playback)])
    output = probe(playback)
    if output["codec"] != "h264" or any(c != "aac" for c in output["audioCodecs"]):
        raise ValueError("输出编码校验失败。")
    if original["audio"] != output["audio"] or abs(output["duration"] - original["duration"]) > 1:
        raise ValueError("输出音轨或时长校验失败。")
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-threads", "2", "-filter_threads", "2",
         "-i", str(playback), "-frames:v", "1", "-vf", "scale='min(iw,480)':-2", str(poster)], 30)
    source_bytes, output_bytes = source.stat().st_size, playback.stat().st_size
    with source.open("rb") as stream:
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
    result = {"input": {**original, "bytes": source_bytes, "sha256": sha},
              "output": {**output, "bytes": output_bytes, "mime": "video/mp4"},
              "posterBytes": poster.stat().st_size, "originalRetained": bool(keep),
              "playbackUsesOriginal": use_original, "transcoded": not use_original,
              "savedRatio": 1 - output_bytes / source_bytes,
              "storedBytes": output_bytes + poster.stat().st_size + (source_bytes if keep and not use_original else 0),
              "warning": ("原素材直接作为播放版本，未重新编码。" if use_original else
                          "转码结果比原视频大；未宣称节省空间。" if output_bytes > source_bytes else
                          "转码后体积未减少。" if output_bytes == source_bytes else "")}
    return result


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.stop = threading.Event()
        with self.db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,status TEXT,preset TEXT,keep_original INTEGER,result TEXT,error TEXT,created REAL,attempts INTEGER NOT NULL DEFAULT 0)")
            if "attempts" not in [row["name"] for row in db.execute("PRAGMA table_info(jobs)")]:
                db.execute("ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0")
            db.execute("UPDATE jobs SET status='failed',error='处理多次中断，请检查服务资源后重试。' WHERE status='processing' AND attempts>=3")
            db.execute("UPDATE jobs SET status='queued' WHERE status='processing'")
            # Interrupted HTTP upload cannot be resumed: keep partial source private.
            db.execute("UPDATE jobs SET status='failed',error='上传中断，请重新上传。' WHERE status='uploading'")
            completed = db.execute("SELECT id,result FROM jobs WHERE status='ready' AND keep_original=0").fetchall()
        # Recover a crash between durable completion and temporary-source cleanup.
        for row in completed:
            if not re.fullmatch(r"[a-f0-9-]{36}", row["id"]):
                continue
            directory = self.root / row["id"]
            source = directory / "source"
            if not source.exists():
                continue
            try:
                result = json.loads(row["result"])
                if ((directory / "playback.mp4").stat().st_size == result["output"]["bytes"]
                        and (directory / "poster.jpg").stat().st_size == result["posterBytes"]):
                    source.unlink()
            except (OSError, ValueError, KeyError, TypeError):
                pass  # Preserve source if backup/derivatives are incomplete.

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.root / "jobs.sqlite", timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, job):
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
        if not row:
            return None
        value = dict(row)
        value["result"] = json.loads(value["result"]) if value["result"] else None
        return value

    def work(self):
        while not self.stop.is_set():
            with self.lock, self.db() as db:
                row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
                if row:
                    db.execute("UPDATE jobs SET status='processing',attempts=attempts+1 WHERE id=?", (row["id"],))
            if not row:
                self.stop.wait(0.5)
                continue
            directory = self.root / row["id"]
            try:
                result = transcode(directory, row["preset"], row["keep_original"])
                with self.db() as db:
                    db.execute("UPDATE jobs SET status='ready',result=? WHERE id=?",
                               (json.dumps(result), row["id"]))
                # Only delete this job's temporary source after verified derivatives and durable result.
                if not row["keep_original"]:
                    (directory / "source").unlink(missing_ok=True)
            except Exception as error:
                message = str(error) if isinstance(error, ValueError) else "处理失败或超时，请重新上传。"
                with self.db() as db:
                    db.execute("UPDATE jobs SET status='failed',error=? WHERE id=?", (message, row["id"]))


def handler(store, token):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass  # Never log auth headers, source filenames, or private paths.

        def reply(self, data, status=200):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def authorized(self):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.reply({"error": "Unauthorized"}, 401)
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            path = urlsplit(self.path).path
            if path == "/health":
                return self.reply({"ok": True, "maxBytes": MAX_BYTES, "maxSeconds": MAX_SECONDS})
            match = re.fullmatch(r"/jobs/([a-f0-9-]{36})(?:/(playback|poster|original))?", path)
            job = store.get(match[1]) if match else None
            if not job:
                return self.reply({"error": "Not found"}, 404)
            if not match[2]:
                return self.reply(job)
            role = match[2]
            if job["status"] != "ready" or (role == "original" and not job["keep_original"]):
                return self.reply({"error": "文件尚未可用。"}, 404)
            file = store.root / job["id"] / {"playback": "playback.mp4", "poster": "poster.jpg", "original": "source"}[role]
            if not file.is_file():
                return self.reply({"error": "文件不存在。"}, 404)
            size, start, end, code = file.stat().st_size, 0, file.stat().st_size - 1, 200
            byte_range = self.headers.get("Range")
            if byte_range:
                parts = re.fullmatch(r"bytes=(\d*)-(\d*)", byte_range)
                if not parts or not any(parts.groups()):
                    return self.reply({"error": "Range 无效。"}, 416)
                if parts[1]:
                    start = int(parts[1]); end = min(int(parts[2]), end) if parts[2] else end
                else:
                    start = max(0, size - int(parts[2]))
                if start > end or start >= size:
                    return self.reply({"error": "Range 超出文件。"}, 416)
                code = 206
            self.send_response(code)
            self.send_header("Content-Type", {"playback": "video/mp4", "poster": "image/jpeg", "original": "application/octet-stream"}[role])
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            if code == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Disposition", f'attachment; filename="{role}.bin"' if role == "original" else "inline")
            self.end_headers()
            with file.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

        def do_POST(self):
            if not self.authorized():
                return
            url = urlsplit(self.path)
            params = parse_qs(url.query)
            preset = params.get("preset", ["standard"])[0]
            keep = params.get("keepOriginal", ["false"])[0] == "true" or preset == "original"
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                size = 0
            if url.path != "/jobs" or preset not in PRESETS:
                return self.reply({"error": "参数无效。"}, 400)
            if not 0 < size <= MAX_BYTES or self.headers.get("Transfer-Encoding"):
                return self.reply({"error": "文件须为 1 字节至 64 MiB，且提供 Content-Length。"}, 413)
            with store.lock, store.db() as db:
                pending = db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('uploading','queued','processing')").fetchone()[0]
                reserved = (pending + 1) * (MAX_BYTES + 258 * 1024 * 1024) + 256 * 1024 * 1024
                if pending >= 4 or shutil.disk_usage(store.root).free < reserved:
                    return self.reply({"error": "队列已满或空间不足，请稍后重试。"}, 429)
                job = str(uuid.uuid4())
                directory = store.root / job
                directory.mkdir()
                db.execute("INSERT INTO jobs(id,status,preset,keep_original,result,error,created) VALUES(?,?,?,?,?,?,?)", (job, "uploading", preset, int(keep), None, None, time.time()))
            try:
                self.connection.settimeout(60)
                with (directory / "source").open("wb") as stream:
                    remaining = size
                    while remaining:
                        chunk = self.rfile.read(min(65536, remaining))
                        if not chunk:
                            raise ValueError("上传中断，请重新上传。")
                        stream.write(chunk)
                        remaining -= len(chunk)
                with store.db() as db:
                    db.execute("UPDATE jobs SET status='queued' WHERE id=?", (job,))
                self.reply({"id": job, "status": "queued"}, 202)
            except Exception:
                with store.db() as db:
                    db.execute("UPDATE jobs SET status='failed',error='上传中断，请重新上传。' WHERE id=?", (job,))
                self.reply({"error": "上传中断，请重新上传。", "id": job}, 400)
    return Handler


def main():
    token = os.environ.get("TRANSCODER_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("Set TRANSCODER_TOKEN to a random secret of at least 32 characters")
    for executable in ("ffmpeg", "ffprobe"):
        if not shutil.which(executable):
            raise SystemExit(f"Missing {executable}")
    store = Store(os.environ.get("TRANSCODER_DATA", "/data"))
    threading.Thread(target=store.work, daemon=True).start()
    server = ThreadingHTTPServer((os.environ.get("TRANSCODER_HOST", "127.0.0.1"), int(os.environ.get("PORT", "8090"))), handler(store, token))
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
