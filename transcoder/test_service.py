import hashlib
import http.client
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from service import Store, handler, probe, transcode


class TranscoderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=os.environ.get("TRANSCODER_TEST_ROOT"))
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / "input.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi",
                        "-i", "testsrc2=size=1920x1080:rate=24", "-f", "lavfi", "-i",
                        "sine=frequency=440:sample_rate=48000", "-t", "1.5", "-c:v",
                        "libx264", "-threads", "2", "-c:a", "aac", "-movflags", "+faststart", str(cls.source)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_actual_encoding_presets_audio_and_original(self):
        checksum = hashlib.sha256(self.source.read_bytes()).hexdigest()
        outputs = []
        for preset, height in [("high", 1080), ("standard", 720), ("economy", 480), ("original", 1080)]:
            directory = self.root / preset
            directory.mkdir()
            shutil.copyfile(self.source, directory / "source")
            result = transcode(directory, preset, preset == "original")
            self.assertEqual(result["input"]["sha256"], checksum)
            self.assertEqual(hashlib.sha256((directory / "source").read_bytes()).hexdigest(), checksum)
            self.assertEqual(result["output"]["height"], height)
            self.assertEqual(result["output"]["codec"], "h264")
            self.assertEqual(result["output"]["audioCodecs"], ["aac"])
            self.assertLess(abs(result["input"]["duration"] - result["output"]["duration"]), 0.2)
            content = (directory / "playback.mp4").read_bytes()
            self.assertLess(content.find(b"moov"), content.find(b"mdat"))
            self.assertGreater(result["posterBytes"], 0)
            outputs.append(content)
            if preset == "original":
                self.assertEqual(content, self.source.read_bytes())
                self.assertTrue(result["playbackUsesOriginal"])
                self.assertEqual((directory / "source").stat().st_ino, (directory / "playback.mp4").stat().st_ino)
        self.assertNotEqual(outputs[0], outputs[1])
        self.assertNotEqual(outputs[1], outputs[2])

    def test_invalid_and_external_playlist_rejected(self):
        path = self.root / "playlist"
        path.write_text('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://example.com/private\n')
        with self.assertRaises(ValueError):
            probe(path)
        path.write_text("not video")
        with self.assertRaises(ValueError):
            probe(path)

    def test_small_silent_video_not_upscaled(self):
        directory = self.root / "silent"
        directory.mkdir()
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi",
                        "-i", "color=size=320x240:rate=24", "-t", "0.5", "-an",
                        "-c:v", "libx264", "-threads", "2", "-f", "mp4", str(directory / "source")], check=True)
        result = transcode(directory, "high", False)
        self.assertEqual((result["output"]["width"], result["output"]["height"]), (320, 240))
        self.assertFalse(result["output"]["audio"])

    def test_private_http_jobs_range_cleanup_and_restart(self):
        directory = self.root / "http"
        store = Store(directory)
        token = "test-only-" + "a" * 40
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler(store, token))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        worker = threading.Thread(target=store.work, daemon=True)
        worker.start()
        def request(method, path, body=None, auth=True, extra=None):
            connection = http.client.HTTPConnection(*server.server_address, timeout=30)
            headers = {"Authorization": "Bearer " + token} if auth else {}
            headers.update(extra or {})
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read()
            result = response.status, data, dict(response.getheaders())
            connection.close()
            return result
        try:
            self.assertEqual(request("GET", "/health", auth=False)[0], 401)
            self.assertEqual(request("POST", "/jobs?preset=bad", b"bad")[0], 400)
            self.assertEqual(request("POST", "/jobs", b"x", extra={"Content-Length": str(64 * 1024 * 1024 + 1)})[0], 413)
            code, data, _ = request("POST", "/jobs", self.source.read_bytes())
            self.assertEqual(code, 202)
            job = json.loads(data)["id"]
            self.assertEqual(request("GET", f"/jobs/{job}/playback", auth=False)[0], 401)
            deadline = time.time() + 30
            while time.time() < deadline:
                data = json.loads(request("GET", f"/jobs/{job}")[1])
                if data["status"] in ["ready", "failed"]:
                    break
                time.sleep(0.1)
            self.assertEqual(data["status"], "ready", data)
            code, chunk, headers = request("GET", f"/jobs/{job}/playback", extra={"Range": "bytes=0-99"})
            self.assertEqual(code, 206)
            self.assertEqual(len(chunk), 100)
            self.assertIn("Content-Range", headers)
            self.assertEqual(request("GET", f"/jobs/{job}/original")[0], 404)
            for _ in range(20):
                if not (directory / job / "source").exists(): break
                time.sleep(0.05)
            self.assertFalse((directory / job / "source").exists())
            code, raw, _ = request("POST", "/jobs?preset=original", self.source.read_bytes())
            self.assertEqual(code, 202)
            original_job = json.loads(raw)["id"]
            deadline = time.time() + 30
            while time.time() < deadline:
                original_data = json.loads(request("GET", f"/jobs/{original_job}")[1])
                if original_data["status"] in ["ready", "failed"]: break
                time.sleep(0.1)
            self.assertEqual(original_data["status"], "ready", original_data)
            self.assertEqual(request("GET", f"/jobs/{original_job}/original")[1], self.source.read_bytes())
            store.stop.set(); worker.join(5)
            # Recreate just this task's temporary source to simulate a crash before cleanup.
            shutil.copyfile(self.source, directory / job / "source")
            self.assertEqual(Store(directory).get(job)["status"], "ready")
            self.assertFalse((directory / job / "source").exists())
            self.assertTrue((directory / original_job / "source").exists())
            # Interrupt recovery preserves source and resumes only pending processing.
            with store.db() as db:
                db.execute("UPDATE jobs SET status='processing' WHERE id=?", (job,))
            self.assertEqual(Store(directory).get(job)["status"], "queued")
            with store.db() as db:
                db.execute("UPDATE jobs SET status='processing',attempts=3 WHERE id=?", (job,))
            self.assertEqual(Store(directory).get(job)["status"], "failed")
        finally:
            store.stop.set(); worker.join(5)
            server.shutdown(); server.server_close()


if __name__ == "__main__":
    unittest.main()
