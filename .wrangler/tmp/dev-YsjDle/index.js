var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/image-size/dist/esm/types/utils.js
var decoder = new TextDecoder();
var toUTF8String = /* @__PURE__ */ __name((input, start = 0, end = input.length) => decoder.decode(input.slice(start, end)), "toUTF8String");
var toHexString = /* @__PURE__ */ __name((input, start = 0, end = input.length) => input.slice(start, end).reduce((memo, i) => memo + `0${i.toString(16)}`.slice(-2), ""), "toHexString");
var getView = /* @__PURE__ */ __name((input, offset) => new DataView(input.buffer, input.byteOffset + offset), "getView");
var readInt16LE = /* @__PURE__ */ __name((input, offset = 0) => getView(input, offset).getInt16(0, true), "readInt16LE");
var readUInt16BE = /* @__PURE__ */ __name((input, offset = 0) => getView(input, offset).getUint16(0, false), "readUInt16BE");
var readUInt16LE = /* @__PURE__ */ __name((input, offset = 0) => getView(input, offset).getUint16(0, true), "readUInt16LE");
var readUInt24LE = /* @__PURE__ */ __name((input, offset = 0) => {
  const view = getView(input, offset);
  return view.getUint16(0, true) + (view.getUint8(2) << 16);
}, "readUInt24LE");
var readInt32LE = /* @__PURE__ */ __name((input, offset = 0) => getView(input, offset).getInt32(0, true), "readInt32LE");
var readUInt32BE = /* @__PURE__ */ __name((input, offset = 0) => getView(input, offset).getUint32(0, false), "readUInt32BE");
var readUInt32LE = /* @__PURE__ */ __name((input, offset = 0) => getView(input, offset).getUint32(0, true), "readUInt32LE");
var readUInt64 = /* @__PURE__ */ __name((input, offset, isBigEndian) => getView(input, offset).getBigUint64(0, !isBigEndian), "readUInt64");
var methods = {
  readUInt16BE,
  readUInt16LE,
  readUInt32BE,
  readUInt32LE
};
function readUInt(input, bits, offset = 0, isBigEndian = false) {
  const endian = isBigEndian ? "BE" : "LE";
  const methodName = `readUInt${bits}${endian}`;
  return methods[methodName](input, offset);
}
__name(readUInt, "readUInt");
var BOX_HEADER_SIZE = 8;
function readBox(input, offset) {
  if (input.length - offset < BOX_HEADER_SIZE)
    return void 0;
  const boxSize = readUInt32BE(input, offset);
  if (input.length - offset < boxSize)
    return void 0;
  return {
    name: toUTF8String(input, 4 + offset, 8 + offset),
    offset,
    size: boxSize
  };
}
__name(readBox, "readBox");
function findBox(input, boxName, startOffset) {
  let currentOffset = startOffset;
  while (currentOffset < input.length) {
    if (input.length - currentOffset < 4)
      break;
    const boxSize = readUInt32BE(input, currentOffset);
    if (boxSize < BOX_HEADER_SIZE) {
      currentOffset += BOX_HEADER_SIZE;
      continue;
    }
    const box = readBox(input, currentOffset);
    if (!box)
      break;
    if (box.name === boxName)
      return box;
    currentOffset += box.size;
  }
  return void 0;
}
__name(findBox, "findBox");

// node_modules/image-size/dist/esm/types/bmp.js
var BMP = {
  validate: /* @__PURE__ */ __name((input) => toUTF8String(input, 0, 2) === "BM", "validate"),
  calculate: /* @__PURE__ */ __name((input) => ({
    height: Math.abs(readInt32LE(input, 22)),
    width: readUInt32LE(input, 18)
  }), "calculate")
};

// node_modules/image-size/dist/esm/types/ico.js
var TYPE_ICON = 1;
var SIZE_HEADER = 2 + 2 + 2;
var SIZE_IMAGE_ENTRY = 1 + 1 + 1 + 1 + 2 + 2 + 4 + 4;
function getSizeFromOffset(input, offset) {
  const value = input[offset];
  return value === 0 ? 256 : value;
}
__name(getSizeFromOffset, "getSizeFromOffset");
function getImageSize(input, imageIndex) {
  const offset = SIZE_HEADER + imageIndex * SIZE_IMAGE_ENTRY;
  return {
    height: getSizeFromOffset(input, offset + 1),
    width: getSizeFromOffset(input, offset)
  };
}
__name(getImageSize, "getImageSize");
var ICO = {
  validate(input) {
    const reserved = readUInt16LE(input, 0);
    const imageCount = readUInt16LE(input, 4);
    if (reserved !== 0 || imageCount === 0)
      return false;
    const imageType = readUInt16LE(input, 2);
    return imageType === TYPE_ICON;
  },
  calculate(input) {
    const nbImages = readUInt16LE(input, 4);
    if (SIZE_HEADER + nbImages * SIZE_IMAGE_ENTRY > input.length) {
      throw new TypeError("Invalid ICO");
    }
    const imageSize2 = getImageSize(input, 0);
    if (nbImages === 1)
      return imageSize2;
    const images = [];
    for (let imageIndex = 0; imageIndex < nbImages; imageIndex += 1) {
      images.push(getImageSize(input, imageIndex));
    }
    return {
      width: imageSize2.width,
      height: imageSize2.height,
      images
    };
  }
};

// node_modules/image-size/dist/esm/types/cur.js
var TYPE_CURSOR = 2;
var CUR = {
  validate(input) {
    const reserved = readUInt16LE(input, 0);
    const imageCount = readUInt16LE(input, 4);
    if (reserved !== 0 || imageCount === 0)
      return false;
    const imageType = readUInt16LE(input, 2);
    return imageType === TYPE_CURSOR;
  },
  calculate: /* @__PURE__ */ __name((input) => ICO.calculate(input), "calculate")
};

// node_modules/image-size/dist/esm/types/dds.js
var DDS = {
  validate: /* @__PURE__ */ __name((input) => readUInt32LE(input, 0) === 542327876, "validate"),
  calculate: /* @__PURE__ */ __name((input) => ({
    height: readUInt32LE(input, 12),
    width: readUInt32LE(input, 16)
  }), "calculate")
};

// node_modules/image-size/dist/esm/types/gif.js
var gifRegexp = /^GIF8[79]a/;
var GIF = {
  validate: /* @__PURE__ */ __name((input) => gifRegexp.test(toUTF8String(input, 0, 6)), "validate"),
  calculate: /* @__PURE__ */ __name((input) => ({
    height: readUInt16LE(input, 8),
    width: readUInt16LE(input, 6)
  }), "calculate")
};

// node_modules/image-size/dist/esm/types/heif.js
var brandMap = {
  avif: "avif",
  mif1: "heif",
  msf1: "heif",
  heic: "heic",
  heix: "heic",
  hevc: "heic",
  hevx: "heic"
};
var HEIF = {
  validate(input) {
    const boxType = toUTF8String(input, 4, 8);
    if (boxType !== "ftyp")
      return false;
    const ftypBox = findBox(input, "ftyp", 0);
    if (!ftypBox)
      return false;
    const brand = toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12);
    return brand in brandMap;
  },
  calculate(input) {
    const metaBox = findBox(input, "meta", 0);
    const iprpBox = metaBox && findBox(input, "iprp", metaBox.offset + 12);
    const ipcoBox = iprpBox && findBox(input, "ipco", iprpBox.offset + 8);
    if (!ipcoBox) {
      throw new TypeError("Invalid HEIF, no ipco box found");
    }
    const type = toUTF8String(input, 8, 12);
    const images = [];
    let currentOffset = ipcoBox.offset + 8;
    while (currentOffset < ipcoBox.offset + ipcoBox.size) {
      const ispeBox = findBox(input, "ispe", currentOffset);
      if (!ispeBox)
        break;
      if (ispeBox.size < 20) {
        throw new TypeError("Invalid HEIF");
      }
      const rawWidth = readUInt32BE(input, ispeBox.offset + 12);
      const rawHeight = readUInt32BE(input, ispeBox.offset + 16);
      const clapBox = findBox(input, "clap", currentOffset);
      let width = rawWidth;
      const height = rawHeight;
      if (clapBox && clapBox.size >= 16 && clapBox.offset < ipcoBox.offset + ipcoBox.size) {
        const cropRight = readUInt32BE(input, clapBox.offset + 12);
        width = rawWidth - cropRight;
      }
      images.push({ height, width });
      const nextOffset = ispeBox.offset + ispeBox.size;
      if (nextOffset <= currentOffset) {
        throw new TypeError("Invalid HEIF");
      }
      currentOffset = nextOffset;
    }
    if (images.length === 0) {
      throw new TypeError("Invalid HEIF, no sizes found");
    }
    return {
      width: images[0].width,
      height: images[0].height,
      type,
      ...images.length > 1 ? { images } : {}
    };
  }
};

// node_modules/image-size/dist/esm/types/icns.js
var SIZE_HEADER2 = 4 + 4;
var FILE_LENGTH_OFFSET = 4;
var ENTRY_LENGTH_OFFSET = 4;
var ICON_TYPE_SIZE = {
  ICON: 32,
  "ICN#": 32,
  "icm#": 16,
  icm4: 16,
  icm8: 16,
  "ics#": 16,
  ics4: 16,
  ics8: 16,
  is32: 16,
  s8mk: 16,
  icp4: 16,
  icl4: 32,
  icl8: 32,
  il32: 32,
  l8mk: 32,
  icp5: 32,
  ic11: 32,
  ich4: 48,
  ich8: 48,
  ih32: 48,
  h8mk: 48,
  icp6: 64,
  ic12: 32,
  it32: 128,
  t8mk: 128,
  ic07: 128,
  ic08: 256,
  ic13: 256,
  ic09: 512,
  ic14: 512,
  ic10: 1024
};
function readImageHeader(input, imageOffset) {
  const imageLengthOffset = imageOffset + ENTRY_LENGTH_OFFSET;
  if (imageLengthOffset + 4 > input.length) {
    throw new TypeError("Invalid ICNS");
  }
  return [
    toUTF8String(input, imageOffset, imageLengthOffset),
    readUInt32BE(input, imageLengthOffset)
  ];
}
__name(readImageHeader, "readImageHeader");
function getImageSize2(type) {
  const size = ICON_TYPE_SIZE[type];
  return { width: size, height: size, type };
}
__name(getImageSize2, "getImageSize");
var ICNS = {
  validate: /* @__PURE__ */ __name((input) => toUTF8String(input, 0, 4) === "icns", "validate"),
  calculate(input) {
    const inputLength = input.length;
    const fileLength = readUInt32BE(input, FILE_LENGTH_OFFSET);
    let imageOffset = SIZE_HEADER2;
    const images = [];
    while (imageOffset < fileLength && imageOffset < inputLength) {
      const imageHeader = readImageHeader(input, imageOffset);
      const entryLength = imageHeader[1];
      if (entryLength < 8) {
        throw new TypeError("Invalid ICNS");
      }
      const imageSize2 = getImageSize2(imageHeader[0]);
      images.push(imageSize2);
      imageOffset += entryLength;
    }
    if (images.length === 0) {
      throw new TypeError("Invalid ICNS, no sizes found");
    }
    return {
      width: images[0].width,
      height: images[0].height,
      ...images.length > 1 ? { images } : {}
    };
  }
};

// node_modules/image-size/dist/esm/types/j2c.js
var J2C = {
  validate: /* @__PURE__ */ __name((input) => readUInt32BE(input, 0) === 4283432785, "validate"),
  calculate: /* @__PURE__ */ __name((input) => ({
    height: readUInt32BE(input, 12),
    width: readUInt32BE(input, 8)
  }), "calculate")
};

// node_modules/image-size/dist/esm/types/jp2.js
var JP2 = {
  validate(input) {
    const boxType = toUTF8String(input, 4, 8);
    if (boxType !== "jP  ")
      return false;
    const ftypBox = findBox(input, "ftyp", 0);
    if (!ftypBox)
      return false;
    const brand = toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12);
    return brand === "jp2 ";
  },
  calculate(input) {
    const jp2hBox = findBox(input, "jp2h", 0);
    const ihdrBox = jp2hBox && findBox(input, "ihdr", jp2hBox.offset + 8);
    if (ihdrBox) {
      return {
        height: readUInt32BE(input, ihdrBox.offset + 8),
        width: readUInt32BE(input, ihdrBox.offset + 12)
      };
    }
    throw new TypeError("Unsupported JPEG 2000 format");
  }
};

// node_modules/image-size/dist/esm/types/jpg.js
var EXIF_MARKER = "45786966";
var APP1_DATA_SIZE_BYTES = 2;
var EXIF_HEADER_BYTES = 6;
var TIFF_BYTE_ALIGN_BYTES = 2;
var BIG_ENDIAN_BYTE_ALIGN = "4d4d";
var LITTLE_ENDIAN_BYTE_ALIGN = "4949";
var IDF_ENTRY_BYTES = 12;
var NUM_DIRECTORY_ENTRIES_BYTES = 2;
function isEXIF(input) {
  return toHexString(input, 2, 6) === EXIF_MARKER;
}
__name(isEXIF, "isEXIF");
function extractSize(input, index) {
  return {
    height: readUInt16BE(input, index),
    width: readUInt16BE(input, index + 2)
  };
}
__name(extractSize, "extractSize");
function extractOrientation(exifBlock, isBigEndian) {
  const idfOffset = 8;
  const offset = EXIF_HEADER_BYTES + idfOffset;
  const idfDirectoryEntries = readUInt(exifBlock, 16, offset, isBigEndian);
  for (let directoryEntryNumber = 0; directoryEntryNumber < idfDirectoryEntries; directoryEntryNumber++) {
    const start = offset + NUM_DIRECTORY_ENTRIES_BYTES + directoryEntryNumber * IDF_ENTRY_BYTES;
    const end = start + IDF_ENTRY_BYTES;
    if (start > exifBlock.length) {
      return;
    }
    const block = exifBlock.slice(start, end);
    const tagNumber = readUInt(block, 16, 0, isBigEndian);
    if (tagNumber === 274) {
      const dataFormat = readUInt(block, 16, 2, isBigEndian);
      if (dataFormat !== 3) {
        return;
      }
      const numberOfComponents = readUInt(block, 32, 4, isBigEndian);
      if (numberOfComponents !== 1) {
        return;
      }
      return readUInt(block, 16, 8, isBigEndian);
    }
  }
}
__name(extractOrientation, "extractOrientation");
function validateExifBlock(input, index) {
  const exifBlock = input.slice(APP1_DATA_SIZE_BYTES, index);
  const byteAlign = toHexString(exifBlock, EXIF_HEADER_BYTES, EXIF_HEADER_BYTES + TIFF_BYTE_ALIGN_BYTES);
  const isBigEndian = byteAlign === BIG_ENDIAN_BYTE_ALIGN;
  const isLittleEndian = byteAlign === LITTLE_ENDIAN_BYTE_ALIGN;
  if (isBigEndian || isLittleEndian) {
    return extractOrientation(exifBlock, isBigEndian);
  }
}
__name(validateExifBlock, "validateExifBlock");
function validateInput(input, index) {
  if (index > input.length) {
    throw new TypeError("Corrupt JPG, exceeded buffer limits");
  }
}
__name(validateInput, "validateInput");
var JPG = {
  validate: /* @__PURE__ */ __name((input) => toHexString(input, 0, 2) === "ffd8", "validate"),
  calculate(_input) {
    let input = _input.slice(4);
    let orientation;
    let next;
    while (input.length) {
      const i = readUInt16BE(input, 0);
      validateInput(input, i);
      if (input[i] !== 255) {
        input = input.slice(1);
        continue;
      }
      if (isEXIF(input)) {
        orientation = validateExifBlock(input, i);
      }
      next = input[i + 1];
      if (next === 192 || next === 193 || next === 194) {
        const size = extractSize(input, i + 5);
        if (!orientation) {
          return size;
        }
        return {
          height: size.height,
          orientation,
          width: size.width
        };
      }
      input = input.slice(i + 2);
    }
    throw new TypeError("Invalid JPG, no size found");
  }
};

// node_modules/image-size/dist/esm/utils/bit-reader.js
var BitReader = class {
  static {
    __name(this, "BitReader");
  }
  input;
  endianness;
  byteOffset = 2;
  bitOffset = 0;
  constructor(input, endianness) {
    this.input = input;
    this.endianness = endianness;
  }
  getBits(length = 1) {
    let result2 = 0;
    let bitsRead = 0;
    while (bitsRead < length) {
      if (this.byteOffset >= this.input.length) {
        throw new Error("Reached end of input");
      }
      const currentByte = this.input[this.byteOffset];
      const bitsLeft = 8 - this.bitOffset;
      const bitsToRead = Math.min(length - bitsRead, bitsLeft);
      if (this.endianness === "little-endian") {
        const mask = (1 << bitsToRead) - 1;
        const bits = currentByte >> this.bitOffset & mask;
        result2 |= bits << bitsRead;
      } else {
        const mask = (1 << bitsToRead) - 1 << 8 - this.bitOffset - bitsToRead;
        const bits = (currentByte & mask) >> 8 - this.bitOffset - bitsToRead;
        result2 = result2 << bitsToRead | bits;
      }
      bitsRead += bitsToRead;
      this.bitOffset += bitsToRead;
      if (this.bitOffset === 8) {
        this.byteOffset++;
        this.bitOffset = 0;
      }
    }
    return result2;
  }
};

// node_modules/image-size/dist/esm/types/jxl-stream.js
function calculateImageDimension(reader, isSmallImage) {
  if (isSmallImage) {
    return 8 * (1 + reader.getBits(5));
  }
  const sizeClass = reader.getBits(2);
  const extraBits = [9, 13, 18, 30][sizeClass];
  return 1 + reader.getBits(extraBits);
}
__name(calculateImageDimension, "calculateImageDimension");
function calculateImageWidth(reader, isSmallImage, widthMode, height) {
  if (isSmallImage && widthMode === 0) {
    return 8 * (1 + reader.getBits(5));
  }
  if (widthMode === 0) {
    return calculateImageDimension(reader, false);
  }
  const aspectRatios = [1, 1.2, 4 / 3, 1.5, 16 / 9, 5 / 4, 2];
  return Math.floor(height * aspectRatios[widthMode - 1]);
}
__name(calculateImageWidth, "calculateImageWidth");
var JXLStream = {
  validate: /* @__PURE__ */ __name((input) => {
    return toHexString(input, 0, 2) === "ff0a";
  }, "validate"),
  calculate(input) {
    const reader = new BitReader(input, "little-endian");
    const isSmallImage = reader.getBits(1) === 1;
    const height = calculateImageDimension(reader, isSmallImage);
    const widthMode = reader.getBits(3);
    const width = calculateImageWidth(reader, isSmallImage, widthMode, height);
    return { width, height };
  }
};

// node_modules/image-size/dist/esm/types/jxl.js
function extractCodestream(input) {
  const jxlcBox = findBox(input, "jxlc", 0);
  if (jxlcBox) {
    return input.slice(jxlcBox.offset + 8, jxlcBox.offset + jxlcBox.size);
  }
  const partialStreams = extractPartialStreams(input);
  if (partialStreams.length > 0) {
    return concatenateCodestreams(partialStreams);
  }
  return void 0;
}
__name(extractCodestream, "extractCodestream");
function extractPartialStreams(input) {
  const partialStreams = [];
  let offset = 0;
  while (offset < input.length) {
    const jxlpBox = findBox(input, "jxlp", offset);
    if (!jxlpBox)
      break;
    if (jxlpBox.size < 12) {
      throw new TypeError("Invalid JXL");
    }
    partialStreams.push(input.slice(jxlpBox.offset + 12, jxlpBox.offset + jxlpBox.size));
    offset = jxlpBox.offset + jxlpBox.size;
  }
  return partialStreams;
}
__name(extractPartialStreams, "extractPartialStreams");
function concatenateCodestreams(partialCodestreams) {
  const totalLength = partialCodestreams.reduce((acc, curr) => acc + curr.length, 0);
  const codestream = new Uint8Array(totalLength);
  let position = 0;
  for (const partial of partialCodestreams) {
    codestream.set(partial, position);
    position += partial.length;
  }
  return codestream;
}
__name(concatenateCodestreams, "concatenateCodestreams");
var JXL = {
  validate: /* @__PURE__ */ __name((input) => {
    const boxType = toUTF8String(input, 4, 8);
    if (boxType !== "JXL ")
      return false;
    const ftypBox = findBox(input, "ftyp", 0);
    if (!ftypBox)
      return false;
    const brand = toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12);
    return brand === "jxl ";
  }, "validate"),
  calculate(input) {
    const codestream = extractCodestream(input);
    if (codestream)
      return JXLStream.calculate(codestream);
    throw new TypeError("Invalid JXL");
  }
};

// node_modules/image-size/dist/esm/types/ktx.js
var KTX = {
  validate: /* @__PURE__ */ __name((input) => {
    const signature = toUTF8String(input, 1, 7);
    return ["KTX 11", "KTX 20"].includes(signature);
  }, "validate"),
  calculate: /* @__PURE__ */ __name((input) => {
    const type = input[5] === 49 ? "ktx" : "ktx2";
    const offset = type === "ktx" ? 36 : 20;
    return {
      height: readUInt32LE(input, offset + 4),
      width: readUInt32LE(input, offset),
      type
    };
  }, "calculate")
};

// node_modules/image-size/dist/esm/types/png.js
var pngSignature = "PNG\r\n\n";
var pngImageHeaderChunkName = "IHDR";
var pngFriedChunkName = "CgBI";
var PNG = {
  validate(input) {
    if (pngSignature === toUTF8String(input, 1, 8)) {
      let chunkName = toUTF8String(input, 12, 16);
      if (chunkName === pngFriedChunkName) {
        chunkName = toUTF8String(input, 28, 32);
      }
      if (chunkName !== pngImageHeaderChunkName) {
        throw new TypeError("Invalid PNG");
      }
      return true;
    }
    return false;
  },
  calculate(input) {
    if (toUTF8String(input, 12, 16) === pngFriedChunkName) {
      return {
        height: readUInt32BE(input, 36),
        width: readUInt32BE(input, 32)
      };
    }
    return {
      height: readUInt32BE(input, 20),
      width: readUInt32BE(input, 16)
    };
  }
};

// node_modules/image-size/dist/esm/types/pnm.js
var PNMTypes = {
  P1: "pbm/ascii",
  P2: "pgm/ascii",
  P3: "ppm/ascii",
  P4: "pbm",
  P5: "pgm",
  P6: "ppm",
  P7: "pam",
  PF: "pfm"
};
var handlers = {
  default: /* @__PURE__ */ __name((lines) => {
    let dimensions = [];
    while (lines.length > 0) {
      const line = lines.shift();
      if (line[0] === "#") {
        continue;
      }
      dimensions = line.split(" ");
      break;
    }
    if (dimensions.length === 2) {
      return {
        height: Number.parseInt(dimensions[1], 10),
        width: Number.parseInt(dimensions[0], 10)
      };
    }
    throw new TypeError("Invalid PNM");
  }, "default"),
  pam: /* @__PURE__ */ __name((lines) => {
    const size = {};
    while (lines.length > 0) {
      const line = lines.shift();
      if (line.length > 16 || line.charCodeAt(0) > 128) {
        continue;
      }
      const [key, value] = line.split(" ");
      if (key && value) {
        size[key.toLowerCase()] = Number.parseInt(value, 10);
      }
      if (size.height && size.width) {
        break;
      }
    }
    if (size.height && size.width) {
      return {
        height: size.height,
        width: size.width
      };
    }
    throw new TypeError("Invalid PAM");
  }, "pam")
};
var PNM = {
  validate: /* @__PURE__ */ __name((input) => toUTF8String(input, 0, 2) in PNMTypes, "validate"),
  calculate(input) {
    const signature = toUTF8String(input, 0, 2);
    const type = PNMTypes[signature];
    const lines = toUTF8String(input, 3).split(/[\r\n]+/);
    const handler = handlers[type] || handlers.default;
    return handler(lines);
  }
};

// node_modules/image-size/dist/esm/types/psd.js
var PSD = {
  validate: /* @__PURE__ */ __name((input) => toUTF8String(input, 0, 4) === "8BPS", "validate"),
  calculate: /* @__PURE__ */ __name((input) => ({
    height: readUInt32BE(input, 14),
    width: readUInt32BE(input, 18)
  }), "calculate")
};

// node_modules/image-size/dist/esm/types/svg.js
var svgReg = /<svg\s([^>"']|"[^"]*"|'[^']*')*>/;
var extractorRegExps = {
  height: /\sheight=(['"])([^%]+?)\1/,
  root: svgReg,
  viewbox: /\sviewBox=(['"])(.+?)\1/i,
  width: /\swidth=(['"])([^%]+?)\1/
};
var INCH_CM = 2.54;
var units = {
  in: 96,
  cm: 96 / INCH_CM,
  em: 16,
  ex: 8,
  m: 96 / INCH_CM * 100,
  mm: 96 / INCH_CM / 10,
  pc: 96 / 72 / 12,
  pt: 96 / 72,
  px: 1
};
var unitsReg = new RegExp(`^([0-9.]+(?:e\\d+)?)(${Object.keys(units).join("|")})?$`);
function parseLength(len) {
  const m = unitsReg.exec(len);
  if (!m) {
    return void 0;
  }
  return Math.round(Number(m[1]) * (units[m[2]] || 1));
}
__name(parseLength, "parseLength");
function parseViewbox(viewbox) {
  const bounds = viewbox.split(" ");
  return {
    height: parseLength(bounds[3]),
    width: parseLength(bounds[2])
  };
}
__name(parseViewbox, "parseViewbox");
function parseAttributes(root) {
  const width = root.match(extractorRegExps.width);
  const height = root.match(extractorRegExps.height);
  const viewbox = root.match(extractorRegExps.viewbox);
  return {
    height: height && parseLength(height[2]),
    viewbox: viewbox && parseViewbox(viewbox[2]),
    width: width && parseLength(width[2])
  };
}
__name(parseAttributes, "parseAttributes");
function calculateByDimensions(attrs) {
  return {
    height: attrs.height,
    width: attrs.width
  };
}
__name(calculateByDimensions, "calculateByDimensions");
function calculateByViewbox(attrs, viewbox) {
  const ratio = viewbox.width / viewbox.height;
  if (attrs.width) {
    return {
      height: Math.floor(attrs.width / ratio),
      width: attrs.width
    };
  }
  if (attrs.height) {
    return {
      height: attrs.height,
      width: Math.floor(attrs.height * ratio)
    };
  }
  return {
    height: viewbox.height,
    width: viewbox.width
  };
}
__name(calculateByViewbox, "calculateByViewbox");
var SVG = {
  validate: /* @__PURE__ */ __name((input) => svgReg.test(toUTF8String(input, 0, 1e3)), "validate"),
  calculate(input) {
    const root = toUTF8String(input).match(extractorRegExps.root);
    if (root) {
      const attrs = parseAttributes(root[0]);
      if (attrs.width && attrs.height) {
        return calculateByDimensions(attrs);
      }
      if (attrs.viewbox) {
        return calculateByViewbox(attrs, attrs.viewbox);
      }
    }
    throw new TypeError("Invalid SVG");
  }
};

// node_modules/image-size/dist/esm/types/tga.js
var TGA = {
  validate(input) {
    return readUInt16LE(input, 0) === 0 && readUInt16LE(input, 4) === 0;
  },
  calculate(input) {
    return {
      height: readUInt16LE(input, 14),
      width: readUInt16LE(input, 12)
    };
  }
};

// node_modules/image-size/dist/esm/types/tiff.js
var CONSTANTS = {
  TAG: {
    WIDTH: 256,
    HEIGHT: 257,
    COMPRESSION: 259
  },
  TYPE: {
    SHORT: 3,
    LONG: 4,
    LONG8: 16
  },
  ENTRY_SIZE: {
    STANDARD: 12,
    BIG: 20
  },
  COUNT_SIZE: {
    STANDARD: 2,
    BIG: 8
  }
};
function readIFD(input, { isBigEndian, isBigTiff }) {
  const ifdOffset = isBigTiff ? Number(readUInt64(input, 8, isBigEndian)) : readUInt(input, 32, 4, isBigEndian);
  const entryCountSize = isBigTiff ? CONSTANTS.COUNT_SIZE.BIG : CONSTANTS.COUNT_SIZE.STANDARD;
  return input.slice(ifdOffset + entryCountSize);
}
__name(readIFD, "readIFD");
function readTagValue(input, type, offset, isBigEndian) {
  switch (type) {
    case CONSTANTS.TYPE.SHORT:
      return readUInt(input, 16, offset, isBigEndian);
    case CONSTANTS.TYPE.LONG:
      return readUInt(input, 32, offset, isBigEndian);
    case CONSTANTS.TYPE.LONG8: {
      const value = Number(readUInt64(input, offset, isBigEndian));
      if (value > Number.MAX_SAFE_INTEGER) {
        throw new TypeError("Value too large");
      }
      return value;
    }
    default:
      return 0;
  }
}
__name(readTagValue, "readTagValue");
function nextTag(input, isBigTiff) {
  const entrySize = isBigTiff ? CONSTANTS.ENTRY_SIZE.BIG : CONSTANTS.ENTRY_SIZE.STANDARD;
  if (input.length > entrySize) {
    return input.slice(entrySize);
  }
}
__name(nextTag, "nextTag");
function extractTags(input, { isBigEndian, isBigTiff }) {
  const tags = {};
  let temp = input;
  while (temp?.length) {
    const code = readUInt(temp, 16, 0, isBigEndian);
    const type = readUInt(temp, 16, 2, isBigEndian);
    const length = isBigTiff ? Number(readUInt64(temp, 4, isBigEndian)) : readUInt(temp, 32, 4, isBigEndian);
    if (code === 0)
      break;
    if (length === 1 && (type === CONSTANTS.TYPE.SHORT || type === CONSTANTS.TYPE.LONG || isBigTiff && type === CONSTANTS.TYPE.LONG8)) {
      const valueOffset = isBigTiff ? 12 : 8;
      tags[code] = readTagValue(temp, type, valueOffset, isBigEndian);
    }
    temp = nextTag(temp, isBigTiff);
  }
  return tags;
}
__name(extractTags, "extractTags");
function determineFormat(input) {
  const signature = toUTF8String(input, 0, 2);
  const version = readUInt(input, 16, 2, signature === "MM");
  return {
    isBigEndian: signature === "MM",
    isBigTiff: version === 43
  };
}
__name(determineFormat, "determineFormat");
function validateBigTIFFHeader(input, isBigEndian) {
  const byteSize = readUInt(input, 16, 4, isBigEndian);
  const reserved = readUInt(input, 16, 6, isBigEndian);
  if (byteSize !== 8 || reserved !== 0) {
    throw new TypeError("Invalid BigTIFF header");
  }
}
__name(validateBigTIFFHeader, "validateBigTIFFHeader");
var signatures = /* @__PURE__ */ new Set([
  "49492a00",
  "4d4d002a",
  "49492b00",
  "4d4d002b"
]);
var TIFF = {
  validate: /* @__PURE__ */ __name((input) => {
    const signature = toHexString(input, 0, 4);
    return signatures.has(signature);
  }, "validate"),
  calculate(input) {
    const format = determineFormat(input);
    if (format.isBigTiff) {
      validateBigTIFFHeader(input, format.isBigEndian);
    }
    const ifdBuffer = readIFD(input, format);
    const tags = extractTags(ifdBuffer, format);
    const info = {
      height: tags[CONSTANTS.TAG.HEIGHT],
      width: tags[CONSTANTS.TAG.WIDTH],
      type: format.isBigTiff ? "bigtiff" : "tiff"
    };
    if (tags[CONSTANTS.TAG.COMPRESSION]) {
      info.compression = tags[CONSTANTS.TAG.COMPRESSION];
    }
    if (!info.width || !info.height) {
      throw new TypeError("Invalid Tiff. Missing tags");
    }
    return info;
  }
};

// node_modules/image-size/dist/esm/types/webp.js
function calculateExtended(input) {
  return {
    height: 1 + readUInt24LE(input, 7),
    width: 1 + readUInt24LE(input, 4)
  };
}
__name(calculateExtended, "calculateExtended");
function calculateLossless(input) {
  return {
    height: 1 + ((input[4] & 15) << 10 | input[3] << 2 | (input[2] & 192) >> 6),
    width: 1 + ((input[2] & 63) << 8 | input[1])
  };
}
__name(calculateLossless, "calculateLossless");
function calculateLossy(input) {
  return {
    height: readInt16LE(input, 8) & 16383,
    width: readInt16LE(input, 6) & 16383
  };
}
__name(calculateLossy, "calculateLossy");
var WEBP = {
  validate(input) {
    const riffHeader = "RIFF" === toUTF8String(input, 0, 4);
    const webpHeader = "WEBP" === toUTF8String(input, 8, 12);
    const vp8Header = "VP8" === toUTF8String(input, 12, 15);
    return riffHeader && webpHeader && vp8Header;
  },
  calculate(_input) {
    const chunkHeader = toUTF8String(_input, 12, 16);
    const input = _input.slice(20, 30);
    if (chunkHeader === "VP8X") {
      const extendedHeader = input[0];
      const validStart = (extendedHeader & 192) === 0;
      const validEnd = (extendedHeader & 1) === 0;
      if (validStart && validEnd) {
        return calculateExtended(input);
      }
      throw new TypeError("Invalid WebP");
    }
    if (chunkHeader === "VP8 " && input[0] !== 47) {
      return calculateLossy(input);
    }
    const signature = toHexString(input, 3, 6);
    if (chunkHeader === "VP8L" && signature !== "9d012a") {
      return calculateLossless(input);
    }
    throw new TypeError("Invalid WebP");
  }
};

// node_modules/image-size/dist/esm/types/index.js
var typeHandlers = /* @__PURE__ */ new Map([
  ["bmp", BMP],
  ["cur", CUR],
  ["dds", DDS],
  ["gif", GIF],
  ["heif", HEIF],
  ["icns", ICNS],
  ["ico", ICO],
  ["j2c", J2C],
  ["jp2", JP2],
  ["jpg", JPG],
  ["jxl", JXL],
  ["jxl-stream", JXLStream],
  ["ktx", KTX],
  ["png", PNG],
  ["pnm", PNM],
  ["psd", PSD],
  ["svg", SVG],
  ["tga", TGA],
  ["tiff", TIFF],
  ["webp", WEBP]
]);
var types = Array.from(typeHandlers.keys());

// node_modules/image-size/dist/esm/detector.js
var firstBytes = /* @__PURE__ */ new Map([
  [0, "heif"],
  [56, "psd"],
  [66, "bmp"],
  [68, "dds"],
  [71, "gif"],
  [73, "tiff"],
  [77, "tiff"],
  [82, "webp"],
  [105, "icns"],
  [137, "png"],
  [255, "jpg"]
]);
function detector(input) {
  const byte = input[0];
  const type = firstBytes.get(byte);
  if (type && typeHandlers.get(type)?.validate(input)) {
    return type;
  }
  return types.find((type2) => typeHandlers.get(type2)?.validate(input));
}
__name(detector, "detector");

// node_modules/image-size/dist/esm/lookup.js
var globalOptions = {
  disabledTypes: []
};
function imageSize(input) {
  const type = detector(input);
  if (typeof type !== "undefined") {
    if (globalOptions.disabledTypes.indexOf(type) > -1) {
      throw new TypeError(`disabled file type: ${type}`);
    }
    const size = typeHandlers.get(type)?.calculate(input);
    if (size !== void 0) {
      size.type = size.type ?? type;
      if (size.images && size.images.length > 1) {
        const largestImage = size.images.reduce((largest, current) => {
          return current.width * current.height > largest.width * largest.height ? current : largest;
        }, size.images[0]);
        size.width = largestImage.width;
        size.height = largestImage.height;
      }
      return size;
    }
  }
  throw new TypeError(`unsupported file type: ${type}`);
}
__name(imageSize, "imageSize");

// src/lib/content.ts
var imageSizes = {
  landscape: 520,
  hills: 520,
  window: 659,
  flower: 520
};
var image = /* @__PURE__ */ __name((id, alt) => ({
  id,
  storageKey: `/media/${id}.svg`,
  kind: "image",
  mimeType: "image/svg+xml",
  byteSize: imageSizes[id] || 0,
  width: 1200,
  height: 900,
  alt,
  processingStatus: "ready",
  createdAt: "2026-10-10T04:00:00Z"
}), "image");
var create = /* @__PURE__ */ __name((id, body, tags, date, extra = {}) => ({
  id,
  body,
  tags,
  kind: "note",
  bodyFormat: "plain",
  status: "published",
  visibility: "public",
  media: [],
  pinned: false,
  createdAt: date,
  updatedAt: date,
  firstPublishedAt: date,
  revision: 1,
  canonicalPath: `/posts/${id}/`,
  ...extra
}), "create");
var posts = [
  create(
    "hello-space",
    "\u628A\u65E5\u5B50\u5199\u4E0B\u6765\uFF0C\u628A\u60F3\u6CD5\u7559\u5728\u8FD9\u91CC\u3002\n\n\u8FD9\u91CC\u662F\u6211\u7684\u4E2A\u4EBA\u7A7A\u95F4\uFF1A\u4E00\u4E9B\u751F\u6D3B\u7247\u6BB5\uFF0C\u4E00\u4E9B\u5DE5\u7A0B\u7B14\u8BB0\uFF0C\u8FD8\u6709\u5076\u5C14\u5192\u51FA\u6765\u7684\u7075\u611F\u3002\u4E0D\u6025\u7740\u7ED9\u6BCF\u4EF6\u4E8B\u4E00\u4E2A\u7ED3\u8BBA\uFF0C\u5148\u8BA4\u771F\u611F\u53D7\uFF0C\u518D\u6162\u6162\u8BB0\u5F55\u3002\n\n\u6B22\u8FCE\u4F60\u6765\u5750\u5750\u3002 \u2615",
    ["\u65E5\u5E38", "\u968F\u60F3"],
    "2026-10-13T01:00:00Z",
    { pinned: true, location: { id: "online", label: "\u7EBF\u4E0A" } }
  ),
  create(
    "afternoon-walk",
    "\u628A\u4E0B\u5348\u7559\u7ED9\u4E00\u573A\u6CA1\u6709\u76EE\u7684\u5730\u7684\u6563\u6B65\u3002\n\n\u98CE\u4ECE\u6811\u68A2\u7A7F\u8FC7\uFF0C\u5149\u843D\u5728\u8DEF\u4E0A\u3002\u79BB\u5F00\u5C4F\u5E55\u4E00\u5C0F\u4F1A\u513F\uFF0C\u624D\u53D1\u73B0\u751F\u6D3B\u91CC\u8FD8\u6709\u8FD9\u4E48\u591A\u5C0F\u5C0F\u7684\u7EC6\u8282\u3002",
    ["\u65E5\u5E38", "\u6563\u6B65"],
    "2026-10-12T07:24:00Z",
    {
      location: { id: "lakeside", label: "\u6E56\u8FB9 \xB7 \u793A\u4F8B\u5730\u70B9" },
      media: [
        image("landscape", "\u539F\u521B\u793A\u4F8B\u63D2\u753B\uFF1A\u6E56\u8FB9\u7684\u5C71\u4E0E\u5915\u9633"),
        image("window", "\u539F\u521B\u793A\u4F8B\u63D2\u753B\uFF1A\u7A97\u8FB9\u7684\u4E00\u676F\u5496\u5561"),
        image("hills", "\u539F\u521B\u793A\u4F8B\u63D2\u753B\uFF1A\u8FDE\u7EF5\u7684\u7EFF\u5C71")
      ]
    }
  ),
  create(
    "making-a-home",
    "\u7F51\u7AD9\u53EF\u4EE5\u5F88\u5C0F\uFF0C\u7A7A\u95F4\u53EF\u4EE5\u5F88\u5927\u3002\n\n\u6211\u60F3\u505A\u4E00\u4E2A\u5C5E\u4E8E\u81EA\u5DF1\u7684\u89D2\u843D\uFF0C\u4E0D\u88AB\u70ED\u5EA6\u548C\u6570\u5B57\u8FFD\u7740\u8D70\u3002\u7528 Astro \u642D\u4E00\u4E2A\u8F7B\u5DE7\u7684\u5165\u53E3\uFF0C\u628A\u9605\u8BFB\u4F53\u9A8C\u548C\u5185\u5BB9\u653E\u5728\u7B2C\u4E00\u4F4D\u3002\n\n\u5148\u628A\u9875\u9762\u505A\u597D\uFF0C\u518D\u7ED9\u5185\u5BB9\u627E\u4E00\u4E2A\u53EF\u9760\u7684\u5BB6\u3002",
    ["\u5DE5\u7A0B\u7B14\u8BB0", "Astro"],
    "2026-10-11T12:30:00Z",
    {
      kind: "article",
      title: "\u7ED9\u81EA\u5DF1\u642D\u4E00\u4E2A\u4E92\u8054\u7F51\u5C0F\u5C4B",
      excerpt: "\u4ECE\u4E00\u5F20\u7A7A\u767D\u9875\u9762\u5F00\u59CB\uFF0C\u8BA9\u8BB0\u5F55\u6709\u4E00\u4E2A\u5B89\u9759\u3001\u957F\u4E45\u7684\u53BB\u5904\u3002"
    }
  ),
  create(
    "flowers-in-motion",
    "\u4ECA\u5929\u7684\u51E0\u79D2\u949F\uFF0C\u7559\u7ED9\u82B1\u548C\u98CE\u3002\n\n\u8FD9\u662F\u4E00\u4E2A\u7528\u4E8E\u9A8C\u8BC1\u64AD\u653E\u4F53\u9A8C\u7684\u516C\u5171\u9886\u57DF\u89C6\u9891\u793A\u4F8B\u3002\u9ED8\u8BA4\u4E0D\u81EA\u52A8\u64AD\u653E\uFF0C\u8BA9\u4F60\u81EA\u5DF1\u51B3\u5B9A\u4EC0\u4E48\u65F6\u5019\u6309\u4E0B\u64AD\u653E\u3002",
    ["\u65E5\u5E38", "\u5F71\u50CF"],
    "2026-10-10T02:15:00Z",
    {
      media: [
        {
          ...image("flower", "\u98CE\u4E2D\u7684\u82B1\u6735"),
          kind: "video",
          storageKey: "/media/flower.mp4",
          thumbnailKey: "/media/flower-poster.png",
          mimeType: "video/mp4",
          byteSize: 1128375,
          width: 960,
          height: 540,
          duration: 5.055
        }
      ]
    }
  ),
  create(
    "less-but-better",
    "\u6700\u8FD1\u5728\u7EC3\u4E60\uFF1A\u5C11\u5F00\u4E00\u4E2A\u6807\u7B7E\u9875\uFF0C\u5C11\u505A\u4E00\u70B9\u65E0\u610F\u4E49\u7684\u6BD4\u8F83\u3002\n\n\u7559\u4E00\u70B9\u7A7A\u767D\uFF0C\u7ED9\u771F\u6B63\u60F3\u505A\u7684\u4E8B\u3002",
    ["\u968F\u60F3"],
    "2026-10-09T08:00:00Z"
  ),
  create(
    "readable-web",
    "\u4E00\u4E2A\u9875\u9762\u7684\u8212\u9002\uFF0C\u5E38\u5E38\u85CF\u5728\u7EC6\u8282\u91CC\u3002\n\n\u5B57\u53F7\u3001\u884C\u9AD8\u3001\u6BB5\u843D\u95F4\u8DDD\uFF0C\u51B3\u5B9A\u6211\u4EEC\u613F\u4E0D\u613F\u610F\u591A\u505C\u7559\u4E00\u5206\u949F\u3002\u505A\u51CF\u6CD5\u4E0D\u662F\u5220\u6389\u6240\u6709\u4E1C\u897F\uFF0C\u800C\u662F\u8BA9\u91CD\u8981\u7684\u4E1C\u897F\u66F4\u5BB9\u6613\u88AB\u770B\u89C1\u3002\n\n\u7ED9\u6587\u5B57\u7559\u51FA\u547C\u5438\u7684\u7A7A\u95F4\u3002\u4E3A\u56FE\u7247\u5199\u4E0B\u63CF\u8FF0\u3002\u8BA9\u952E\u76D8\u4E5F\u80FD\u8D70\u904D\u6BCF\u4E00\u5904\u3002",
    ["\u5DE5\u7A0B\u7B14\u8BB0", "\u8BBE\u8BA1"],
    "2026-10-08T03:00:00Z",
    {
      kind: "article",
      title: "\u8BA9\u9875\u9762\u6162\u4E0B\u6765\uFF0C\u8BA9\u6587\u5B57\u88AB\u770B\u89C1",
      excerpt: "\u5173\u4E8E\u7559\u767D\u3001\u6392\u7248\u4E0E\u4E00\u4E2A\u66F4\u8212\u9002\u7684\u9605\u8BFB\u4F53\u9A8C\u3002"
    }
  ),
  create(
    "weekend-list",
    "\u5468\u672B\u7684\u5C0F\u6E05\u5355\uFF1A\n\n\u8BFB\u51E0\u9875\u4E66\uFF0C\u6574\u7406\u684C\u9762\uFF0C\u7ED9\u690D\u7269\u6D47\u6C34\u3002\n\u4E0D\u9700\u8981\u5B8C\u6210\u5F88\u591A\uFF0C\u4E5F\u53EF\u4EE5\u662F\u5F88\u597D\u7684\u4E00\u5929\u3002",
    ["\u65E5\u5E38"],
    "2026-10-07T05:00:00Z"
  ),
  create(
    "private-draft",
    "DRAFT_SENTINEL_NEVER_PUBLIC",
    ["\u8349\u7A3F"],
    "2026-10-14T00:00:00Z",
    { status: "draft" }
  )
];
var published = /* @__PURE__ */ __name(() => posts.filter((p) => p.status === "published" && p.visibility === "public").sort(
  (a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.firstPublishedAt) - Date.parse(a.firstPublishedAt)
), "published");
var repository = {
  async listPublished({ page, pageSize, kind, tag: tag2, location }) {
    const list = published().filter(
      (p) => (!kind || p.kind === kind) && (!tag2 || p.tags.includes(tag2)) && (!location || p.location?.id === location)
    );
    const start = (page - 1) * pageSize;
    return {
      items: list.slice(start, start + pageSize),
      hasMore: start + pageSize < list.length
    };
  },
  async getPublished(id) {
    return published().find((p) => p.id === id);
  },
  async getTags() {
    return [...new Set(published().flatMap((p) => p.tags))];
  },
  async getLocations() {
    return [
      ...new Map(
        published().filter((p) => p.location).map((p) => [p.location.id, p.location])
      ).values()
    ];
  },
  async getProfile() {
    return {
      name: "SFSafi",
      handle: "@sfsafi",
      bio: "\u8BB0\u5F55\u751F\u6D3B\uFF0C\u4E5F\u8BB0\u5F55\u90A3\u4E9B\u6B63\u5728\u53D1\u751F\u7684\u60F3\u6CD5\u3002",
      location: "\u5728\u4E92\u8054\u7F51\u7684\u4E00\u9685"
    };
  },
  mediaUrl(media) {
    return media.storageKey;
  }
};

// node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder2 = new TextDecoder();
var strictDecoder = new TextDecoder("utf-8", { fatal: true });
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0), buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers)
    buf.set(buffer, i), i += buffer.length;
  return buf;
}
__name(concat, "concat");
var NON_ASCII = /[^\x00-\x7f]/;
function encode(string) {
  if (typeof string == "string" && string.length >= 128) {
    if (NON_ASCII.test(string))
      throw new TypeError("non-ASCII string encountered in encode()");
    return encoder.encode(string);
  }
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127)
      throw new TypeError("non-ASCII string encountered in encode()");
    bytes[i] = code;
  }
  return bytes;
}
__name(encode, "encode");
function decodeBase64(encoded, url = false) {
  if (Uint8Array.fromBase64)
    return Uint8Array.fromBase64(encoded, { alphabet: url ? "base64url" : "base64" });
  if (url) {
    if (encoded.includes("+") || encoded.includes("/"))
      throw new TypeError("Invalid base64url");
    encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  }
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(decodeBase64, "decodeBase64");

// node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static {
    __name(this, "JOSEError");
  }
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options), this.name = this.constructor.name, Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static {
    __name(this, "JWTClaimValidationFailed");
  }
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static {
    __name(this, "JWTExpired");
  }
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static {
    __name(this, "JOSEAlgNotAllowed");
  }
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static {
    __name(this, "JOSENotSupported");
  }
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static {
    __name(this, "JWSInvalid");
  }
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static {
    __name(this, "JWTInvalid");
  }
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWKSInvalid = class extends JOSEError {
  static {
    __name(this, "JWKSInvalid");
  }
  static code = "ERR_JWKS_INVALID";
  code = "ERR_JWKS_INVALID";
};
var JWKSNoMatchingKey = class extends JOSEError {
  static {
    __name(this, "JWKSNoMatchingKey");
  }
  static code = "ERR_JWKS_NO_MATCHING_KEY";
  code = "ERR_JWKS_NO_MATCHING_KEY";
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSMultipleMatchingKeys = class extends JOSEError {
  static {
    __name(this, "JWKSMultipleMatchingKeys");
  }
  [Symbol.asyncIterator] = async function* () {
  };
  static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSTimeout = class extends JOSEError {
  static {
    __name(this, "JWKSTimeout");
  }
  static code = "ERR_JWKS_TIMEOUT";
  code = "ERR_JWKS_TIMEOUT";
  constructor(message2 = "request timed out", options) {
    super(message2, options);
  }
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static {
    __name(this, "JWSSignatureVerificationFailed");
  }
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// node_modules/jose/dist/webapi/util/base64url.js
var invalid = "The input to be decoded is not correctly encoded.";
function decode(input) {
  try {
    return decodeBase64(typeof input == "string" ? input : decoder2.decode(input), true);
  } catch (cause) {
    throw new TypeError(invalid, { cause });
  }
}
__name(decode, "decode");

// node_modules/jose/dist/webapi/lib/validate.js
function isObject(input) {
  if (typeof input != "object" || input === null || Object.prototype.toString.call(input) !== "[object Object]")
    return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
__name(isObject, "isObject");
function isJwkSet(input) {
  return isObject(input) && Array.isArray(input.keys) && Array.from(input.keys).every(isObject);
}
__name(isJwkSet, "isJwkSet");
function isDisjoint(...headers) {
  const parameters = /* @__PURE__ */ new Set();
  for (const header of headers)
    if (header)
      for (const parameter of Object.keys(header)) {
        if (parameters.has(parameter))
          return false;
        parameters.add(parameter);
      }
  return true;
}
__name(isDisjoint, "isDisjoint");
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label}`);
  }
}
__name(decodeBase64url, "decodeBase64url");
function encodeBase64url(value, label, ErrorClass) {
  try {
    return encode(value);
  } catch {
    throw new ErrorClass(`The ${label} is not a valid base64url string`);
  }
}
__name(encodeBase64url, "encodeBase64url");
function parseJoseHeader(b64, ErrorClass, message2) {
  let parsed;
  try {
    parsed = JSON.parse(strictDecoder.decode(decode(b64)));
  } catch {
    throw new ErrorClass(message2);
  }
  if (!isObject(parsed))
    throw new ErrorClass(message2);
  return parsed;
}
__name(parseJoseHeader, "parseJoseHeader");
var JWS_RECOGNIZED = { __proto__: null, b64: true };
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s != "string")))
    throw new TypeError(`"${option}" option must be an array of strings`);
  return algorithms === void 0 ? void 0 : new Set(algorithms);
}
__name(validateAlgorithms, "validateAlgorithms");
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0)
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  if (!protectedHeader || protectedHeader.crit === void 0)
    return [];
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input != "string" || input.length === 0))
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  const recognized = recognizedOption === void 0 ? recognizedDefault : { __proto__: null, ...recognizedOption, ...recognizedDefault };
  for (const parameter of protectedHeader.crit) {
    if (!(parameter in recognized))
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    if (!Object.hasOwn(joseHeader, parameter) || joseHeader[parameter] === void 0)
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    if (recognized[parameter] && (!Object.hasOwn(protectedHeader, parameter) || protectedHeader[parameter] === void 0))
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
  }
  return protectedHeader.crit;
}
__name(validateCrit, "validateCrit");
function validateB64(protectedHeader, extensions) {
  if (extensions.includes("b64")) {
    const b64 = protectedHeader.b64;
    if (typeof b64 != "boolean")
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    return b64;
  }
  return true;
}
__name(validateB64, "validateB64");

// node_modules/jose/dist/webapi/lib/key.js
var tag = /* @__PURE__ */ __name((key) => key[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((entry, key, usage) => {
  const { alg } = entry;
  if (key.use !== void 0) {
    const expected = usage === "sign" || usage === "verify" ? "sig" : "enc";
    if (key.use !== expected)
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
  }
  if (key.alg !== void 0 && key.alg !== alg)
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  if (Array.isArray(key.key_ops)) {
    const expectedKeyOp = usage === "encrypt" || usage === "decrypt" ? entry.ops?.[usage === "encrypt" ? 0 : 1] : usage;
    if (expectedKeyOp && !key.key_ops.includes(expectedKeyOp))
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
  }
}, "jwkMatchesOp");
async function prepareKey(entry, key, usage) {
  const { alg, secret } = entry, privateKey = usage === "decrypt" || usage === "sign";
  if (secret && key instanceof Uint8Array)
    return key;
  let normalized, keyObject;
  if (isObject(key)) {
    if (normalized = normalizeJwk(key), typeof normalized.kty != "string")
      throw invalidKeyType(alg, key, secret);
    if (!(secret ? normalized.kty === "oct" && typeof normalized.k == "string" : normalized.kty !== "oct" && (privateKey ? normalized.kty === "AKP" && typeof normalized.priv == "string" || typeof normalized.d == "string" : normalized.d === void 0 && normalized.priv === void 0)))
      throw new TypeError(secret ? 'JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present' : `JSON Web Key for this operation must be a ${privateKey ? "private" : "public"} JWK`);
    if (jwkMatchesOp(entry, normalized, usage), normalized.kty === "oct")
      return decode(normalized.k);
    if (!Object.isFrozen(key)) {
      const { key_ops } = key;
      Array.isArray(key_ops) && Object.freeze(key_ops), Object.freeze(key);
    }
  } else {
    if (!isKeyLike(key))
      throw invalidKeyType(alg, key, secret);
    const expectedType = secret ? "secret" : privateKey ? "private" : "public";
    if (key.type !== expectedType && (secret || ["secret", "public", "private"].includes(key.type)))
      throw new TypeError(`${tag(key)} instances must be of type "${expectedType}" for the ${alg} algorithm`);
    if (isCryptoKey(key))
      return key;
    if (keyObject = key, keyObject.type === "secret")
      return keyObject.export();
  }
  cache ||= /* @__PURE__ */ new WeakMap();
  const cacheKey = key;
  let cached = cache.get(cacheKey);
  if (cached?.[alg])
    return cached[alg];
  if (cached || cache.set(cacheKey, cached = {}), keyObject && typeof keyObject.toCryptoKey == "function") {
    const isPublic = keyObject.type === "public", crv = nist[keyObject.asymmetricKeyDetails?.namedCurve], params = entry.resolve?.({ crv, asymmetricKeyType: keyObject.asymmetricKeyType }) ?? entry.subtle;
    return cached[alg] = keyObject.toCryptoKey(params, isPublic, entry.usages[isPublic ? 0 : 1]);
  }
  return normalized ??= keyObject.export({ format: "jwk" }), normalized.alg = alg, cached[alg] = await jwkToKey(entry, normalized);
}
__name(prepareKey, "prepareKey");
var cache;
var nist = {
  __proto__: null,
  prime256v1: "P-256",
  secp384r1: "P-384",
  secp521r1: "P-521"
};
var isCryptoKey = /* @__PURE__ */ __name((key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
}, "isCryptoKey");
var isKeyObject = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag] === "KeyObject", "isKeyObject");
var isKeyLike = /* @__PURE__ */ __name((key) => isCryptoKey(key) || isKeyObject(key), "isKeyLike");
function message(msg, actual, ...types2) {
  if (types2.length > 2) {
    const last = types2.pop();
    msg += `one of type ${types2.join(", ")}, or ${last}.`;
  } else types2.length === 2 ? msg += `one of type ${types2[0]} or ${types2[1]}.` : msg += `of type ${types2[0]}.`;
  return actual == null ? msg += ` Received ${actual}` : typeof actual == "function" && actual.name ? msg += ` Received function ${actual.name}` : typeof actual == "object" && actual != null && actual.constructor?.name && (msg += ` Received an instance of ${actual.constructor.name}`), msg;
}
__name(message, "message");
function invalidKeyType(alg, actual, secret) {
  const types2 = ["CryptoKey", "KeyObject", "JSON Web Key"];
  return secret && types2.push("Uint8Array"), new TypeError(message(`Key for the ${alg} algorithm must be `, actual, ...types2));
}
__name(invalidKeyType, "invalidKeyType");
var unusable = /* @__PURE__ */ __name((name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`), "unusable");
function checkUsage(key, usage) {
  if (usage && !key.usages.includes(usage))
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
}
__name(checkUsage, "checkUsage");
function checkModulusLength(alg, key) {
  const { modulusLength } = key.algorithm;
  if (typeof modulusLength != "number" || modulusLength < 2048)
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
}
__name(checkModulusLength, "checkModulusLength");
function checkCryptoKey(key, expected, usage) {
  const algorithm = key.algorithm;
  if (algorithm.name !== expected.name)
    throw unusable(expected.name);
  if (expected.hash && algorithm.hash?.name !== expected.hash)
    throw unusable(expected.hash, "algorithm.hash");
  if (expected.namedCurve && algorithm.namedCurve !== expected.namedCurve)
    throw unusable(expected.namedCurve, "algorithm.namedCurve");
  if (expected.length !== void 0 && algorithm.length !== expected.length)
    throw unusable(expected.length, "algorithm.length");
  checkUsage(key, usage);
}
__name(checkCryptoKey, "checkCryptoKey");
function snapshotJwk(jwk) {
  return { __proto__: null, ...jwk };
}
__name(snapshotJwk, "snapshotJwk");
function normalizeJwk(jwk) {
  const normalized = snapshotJwk(jwk);
  if (normalized.ext !== void 0 && typeof normalized.ext != "boolean")
    throw new TypeError('"ext" (Extractable) Parameter must be a boolean');
  if (normalized.key_ops !== void 0) {
    const value = normalized.key_ops, keyOps = Array.isArray(value) ? [...value] : void 0;
    if (!keyOps || keyOps.some((operation) => typeof operation != "string") || new Set(keyOps).size !== keyOps.length)
      throw new TypeError('"key_ops" (Key Operations) Parameter must be an array of unique strings');
    normalized.key_ops = keyOps;
  }
  return normalized;
}
__name(normalizeJwk, "normalizeJwk");
async function jwkToKey(entry, jwk, extractable) {
  if (!entry.kty.includes(jwk.kty))
    throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
  const algorithm = entry.resolve?.({ kty: jwk.kty, crv: jwk.crv }) ?? entry.subtle, isPrivate = !!(jwk.d || jwk.priv), keyData = { ...jwk, ext: extractable ?? jwk.ext };
  return keyData.kty !== "AKP" && delete keyData.alg, delete keyData.use, crypto.subtle.importKey("jwk", keyData, algorithm, keyData.ext ?? !isPrivate, jwk.key_ops ?? entry.usages[isPrivate ? 1 : 0]);
}
__name(jwkToKey, "jwkToKey");
async function rawKey(key, expected, usage, extractable = false) {
  return key instanceof Uint8Array && (key = await crypto.subtle.importKey("raw", key, expected, extractable, [usage])), checkCryptoKey(key, expected, usage), key;
}
__name(rawKey, "rawKey");

// node_modules/jose/dist/webapi/lib/key_descriptor.js
function table(entries) {
  const out = { __proto__: null };
  for (const alg in entries)
    out[alg] = { ...entries[alg], alg };
  return out;
}
__name(table, "table");

// node_modules/jose/dist/webapi/lib/jws_algorithms.js
var sig = [["verify"], ["sign"]];
function hmac(bits) {
  const subtle = { name: "HMAC", hash: `SHA-${bits}` };
  return { kty: ["oct"], secret: true, subtle, signing: subtle, usages: sig };
}
__name(hmac, "hmac");
function rsa(bits, saltLength) {
  const subtle = { name: saltLength ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: `SHA-${bits}` };
  return {
    kty: ["RSA"],
    subtle,
    signing: saltLength ? { ...subtle, saltLength } : subtle,
    usages: sig,
    minRsaBits: 2048
  };
}
__name(rsa, "rsa");
function ecdsa(crv, bits) {
  return {
    kty: ["EC"],
    crv,
    subtle: { name: "ECDSA", namedCurve: crv },
    signing: { name: "ECDSA", hash: `SHA-${bits}` },
    usages: sig
  };
}
__name(ecdsa, "ecdsa");
function eddsa() {
  const subtle = { name: "Ed25519" };
  return {
    kty: ["OKP"],
    crv: "Ed25519",
    subtle,
    signing: subtle,
    usages: sig
  };
}
__name(eddsa, "eddsa");
function mldsa(bits) {
  const subtle = { name: `ML-DSA-${bits}` };
  return {
    kty: ["AKP"],
    subtle,
    signing: subtle,
    usages: sig
  };
}
__name(mldsa, "mldsa");
var JWS = table({
  HS256: hmac(256),
  HS384: hmac(384),
  HS512: hmac(512),
  RS256: rsa(256),
  RS384: rsa(384),
  RS512: rsa(512),
  PS256: rsa(256, 32),
  PS384: rsa(384, 48),
  PS512: rsa(512, 64),
  ES256: ecdsa("P-256", 256),
  ES384: ecdsa("P-384", 384),
  ES512: ecdsa("P-521", 512),
  EdDSA: eddsa(),
  Ed25519: eddsa(),
  "ML-DSA-44": mldsa(44),
  "ML-DSA-65": mldsa(65),
  "ML-DSA-87": mldsa(87)
});
function jwsAlgorithm(alg) {
  const entry = typeof alg == "string" ? JWS[alg] : void 0;
  if (!entry)
    throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  return entry;
}
__name(jwsAlgorithm, "jwsAlgorithm");

// node_modules/jose/dist/webapi/lib/jws_verify.js
function prepareVerify(options) {
  return [options && validateAlgorithms("algorithms", options.algorithms), options?.crit];
}
__name(prepareVerify, "prepareVerify");
function parseProtectedHeader(encodedProtected) {
  return encodedProtected === void 0 ? {} : parseJoseHeader(encodedProtected, JWSInvalid, "JWS Protected Header is invalid");
}
__name(parseProtectedHeader, "parseProtectedHeader");
function encodeCompactUnencodedPayload(payload) {
  try {
    return encode(payload);
  } catch {
    throw new JWSInvalid("JWS Compact Serialization payload must use only ASCII characters");
  }
}
__name(encodeCompactUnencodedPayload, "encodeCompactUnencodedPayload");
async function verifySignature(jws, shared, key, encodeUnencodedPayload, parsedProtected) {
  const { protected: encodedProtected, header, payload: inputPayload } = jws, parsedProt = parsedProtected ?? parseProtectedHeader(encodedProtected);
  if (!isDisjoint(parsedProt, header))
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  const joseHeader = { ...parsedProt, ...header }, b64 = validateB64(parsedProt, validateCrit(JWSInvalid, JWS_RECOGNIZED, shared[1], parsedProt, joseHeader)), { alg } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  if (shared[0] && !shared[0].has(alg))
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  if (b64) {
    if (typeof inputPayload != "string")
      throw new JWSInvalid("JWS Payload must be a string");
  } else if (typeof inputPayload != "string" && !(inputPayload instanceof Uint8Array))
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  const signingPayload = b64 || typeof inputPayload != "string" ? inputPayload : encodeUnencodedPayload(inputPayload);
  let resolvedKey = false;
  typeof key == "function" && (key = await key(parsedProt, jws), resolvedKey = true);
  const entry = jwsAlgorithm(alg), data = concat(encodedProtected !== void 0 ? encode(encodedProtected) : new Uint8Array(), encode("."), typeof signingPayload == "string" ? shared[2] ??= encodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload), signature = decodeBase64url(jws.signature, "signature", JWSInvalid), k = await prepareKey(entry, key, "verify"), cryptoKey = await rawKey(k, entry.subtle, "verify");
  entry.minRsaBits && checkModulusLength(entry.alg, cryptoKey);
  let verified = false;
  try {
    verified = await crypto.subtle.verify(entry.signing, cryptoKey, signature, data);
  } catch {
  }
  if (!verified)
    throw new JWSSignatureVerificationFailed();
  const result2 = { payload: typeof signingPayload == "string" ? decodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload };
  return encodedProtected !== void 0 && (result2.protectedHeader = parsedProt), header !== void 0 && (result2.unprotectedHeader = header), resolvedKey ? [{ ...result2, key: k }, b64] : [result2, b64];
}
__name(verifySignature, "verifySignature");
async function verifyCompact(jws, shared, key) {
  if (jws instanceof Uint8Array && (jws = decoder2.decode(jws)), typeof jws != "string")
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3)
    throw new JWSInvalid("Invalid Compact JWS");
  return verifySignature({ payload, protected: protectedHeader, signature }, shared, key, encodeCompactUnencodedPayload);
}
__name(verifyCompact, "verifyCompact");

// node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "epoch");
var multipliers = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31557600
};
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var checkFailed = "check_failed";
function invalidDuration() {
  throw new TypeError("Invalid time period format");
}
__name(invalidDuration, "invalidDuration");
function secs(str) {
  typeof str != "string" && invalidDuration();
  const matched = REGEX.exec(str);
  (!matched || matched[4] && matched[1]) && invalidDuration();
  const value = parseFloat(matched[2]), numericDate2 = Math.round(value * multipliers[matched[3][0].toLowerCase()]);
  return Number.isFinite(numericDate2) || invalidDuration(), matched[1] === "-" || matched[4] === "ago" ? -numericDate2 : numericDate2;
}
__name(secs, "secs");
function validateInput2(label, input) {
  if (!Number.isFinite(input))
    throw new TypeError(`Invalid ${label} input`);
  return input;
}
__name(validateInput2, "validateInput");
var normalizeTyp = /* @__PURE__ */ __name((value) => {
  const normalized = value.toLowerCase();
  return value.includes("/") ? normalized : `application/${normalized}`;
}, "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => typeof audPayload == "string" ? audOption.includes(audPayload) : Array.isArray(audPayload) ? audOption.some((aud) => audPayload.includes(aud)) : false, "checkAudiencePresence");
function validateNumericDate(payload, claim, required = false) {
  const value = payload[claim];
  if (!(value === void 0 && !required)) {
    if (typeof value != "number")
      throw new JWTClaimValidationFailed(`"${claim}" claim must be a number`, payload, claim, "invalid");
    return value;
  }
}
__name(validateNumericDate, "validateNumericDate");
function unexpectedClaim(payload, claim) {
  throw new JWTClaimValidationFailed(`unexpected "${claim}" claim value`, payload, claim, checkFailed);
}
__name(unexpectedClaim, "unexpectedClaim");
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(strictDecoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload))
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  const { typ } = options;
  if (typ !== void 0 && (typeof protectedHeader.typ != "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ)))
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", checkFailed);
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options, presenceCheck = [...requiredClaims];
  maxTokenAge !== void 0 && presenceCheck.push("iat"), audience !== void 0 && presenceCheck.push("aud"), subject !== void 0 && presenceCheck.push("sub"), issuer !== void 0 && presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse()))
    if (!Object.hasOwn(payload, claim))
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
  issuer !== void 0 && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss) && unexpectedClaim(payload, "iss"), subject !== void 0 && payload.sub !== subject && unexpectedClaim(payload, "sub"), audience !== void 0 && !checkAudiencePresence(payload.aud, typeof audience == "string" ? [audience] : audience) && unexpectedClaim(payload, "aud");
  const { clockTolerance } = options;
  let tolerance = 0;
  if (typeof clockTolerance == "string")
    tolerance = secs(clockTolerance);
  else if (clockTolerance !== void 0) {
    if (typeof clockTolerance != "number")
      throw new TypeError("Invalid clockTolerance option type");
    tolerance = clockTolerance;
  }
  validateInput2("clockTolerance option", tolerance);
  const { currentDate } = options, now = validateInput2("currentDate option", epoch(currentDate === void 0 ? /* @__PURE__ */ new Date() : currentDate)), iat = validateNumericDate(payload, "iat", maxTokenAge !== void 0), nbf = validateNumericDate(payload, "nbf");
  if (nbf !== void 0 && nbf > now + tolerance)
    throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", checkFailed);
  const exp = validateNumericDate(payload, "exp");
  if (exp !== void 0 && exp <= now - tolerance)
    throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", checkFailed);
  if (maxTokenAge !== void 0) {
    const age = now - iat, max = validateInput2("maxTokenAge option", typeof maxTokenAge == "number" ? maxTokenAge : secs(maxTokenAge));
    if (age - tolerance > max)
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", checkFailed);
    if (age < -tolerance)
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", checkFailed);
  }
  return payload;
}
__name(validateClaimsSet, "validateClaimsSet");

// node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const [verified, b64] = await verifyCompact(jwt, prepareVerify(options), key);
  if (!b64)
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  return { ...verified, payload };
}
__name(jwtVerify, "jwtVerify");

// node_modules/jose/dist/webapi/jwks/local.js
function isUsableJWK(jwk, entry, alg, kid) {
  const { kty, key_ops: keyOps, ext, kid: jwkKid, alg: jwkAlg, use, crv } = jwk;
  return (ext === void 0 || typeof ext == "boolean") && (keyOps === void 0 || Array.isArray(keyOps) && keyOps.every((operation, index) => typeof operation == "string" && keyOps.indexOf(operation) === index) && keyOps.includes("verify")) && entry.kty.includes(kty) && (kid === void 0 || typeof kid == "string" && kid === jwkKid) && (jwkAlg === void 0 ? kty !== "AKP" : alg === jwkAlg) && (use === void 0 || use === "sig") && (!entry.crv || crv === entry.crv);
}
__name(isUsableJWK, "isUsableJWK");
async function importWithAlgCache(cache2, jwk, entry) {
  const cached = cache2.get(jwk) || cache2.set(jwk, {}).get(jwk), { alg } = entry;
  if (cached[alg] === void 0) {
    const pending = jwkToKey(entry, jwk, true).then((key) => {
      if (key.type !== "public")
        throw new JWKSInvalid("JSON Web Key Set members must be public keys");
      return cached[alg] = key, key;
    }).catch((error) => {
      throw cached[alg] === pending && delete cached[alg], error;
    });
    cached[alg] = pending;
  }
  return cached[alg];
}
__name(importWithAlgCache, "importWithAlgCache");
function createLocalJWKSet(jwks) {
  let snapshot;
  try {
    snapshot = structuredClone(jwks);
  } catch {
  }
  if (!isJwkSet(snapshot))
    throw new JWKSInvalid("JSON Web Key Set malformed");
  const metadata = snapshot.keys.map((jwk) => {
    const normalized = snapshotJwk(jwk);
    return Array.isArray(normalized.key_ops) && (normalized.key_ops = [...normalized.key_ops]), normalized;
  }), cached = /* @__PURE__ */ new WeakMap();
  return Object.defineProperty(async (protectedHeader, token) => {
    const { alg, kid } = { ...protectedHeader, ...token?.header }, entry = typeof alg == "string" ? JWS[alg] : void 0;
    if (!entry || entry.secret)
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
    const candidates = snapshot.keys.filter((_, index) => isUsableJWK(metadata[index], entry, alg, kid)), { 0: jwk, length } = candidates;
    if (!length)
      throw new JWKSNoMatchingKey();
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys();
      throw error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates)
          try {
            yield await importWithAlgCache(cached, jwk2, entry);
          } catch {
          }
      }, error;
    }
    return importWithAlgCache(cached, jwk, entry);
  }, "jwks", {
    value: /* @__PURE__ */ __name(() => structuredClone(snapshot), "value")
  });
}
__name(createLocalJWKSet, "createLocalJWKSet");

// node_modules/jose/dist/webapi/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair < "u" || typeof navigator < "u" && true || typeof EdgeRuntime < "u" && EdgeRuntime === "vercel";
}
__name(isCloudflareWorkers, "isCloudflareWorkers");
var USER_AGENT;
(typeof navigator > "u" || !"Cloudflare-Workers"?.startsWith?.("Mozilla/5.0 ")) && (USER_AGENT = "jose/v6.2.12");
var customFetch = /* @__PURE__ */ Symbol();
async function fetchJwks(url, headers, signal, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    redirect: "manual",
    headers
  }).catch((err) => {
    throw err.name === "TimeoutError" ? new JWKSTimeout() : err;
  });
  if (response.status !== 200)
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  try {
    return await response.json();
  } catch {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
  }
}
__name(fetchJwks, "fetchJwks");
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshFor(timestamp, duration) {
  return Number.isFinite(timestamp) && Date.now() < timestamp + duration;
}
__name(isFreshFor, "isFreshFor");
function validateDuration(value, fallback, option) {
  if (Number.isNaN(value))
    throw new TypeError(`"${option}" option must not be NaN`);
  return typeof value == "number" ? value : fallback;
}
__name(validateDuration, "validateDuration");
function createRemoteJWKSet(url, options) {
  if (!(url instanceof URL))
    throw new TypeError("url must be an instance of URL");
  const href = new URL(url.href).href, opts = options ?? {}, timeoutOption = opts.timeoutDuration;
  if (typeof timeoutOption == "number" && (!Number.isInteger(timeoutOption) || timeoutOption < 0))
    throw new TypeError('"timeoutDuration" option must be a non-negative integer');
  const timeoutDuration = typeof timeoutOption == "number" ? timeoutOption : 5e3, cooldownDuration = validateDuration(opts.cooldownDuration, 3e4, "cooldownDuration"), cacheMaxAge = validateDuration(opts.cacheMaxAge, 6e5, "cacheMaxAge"), headers = new Headers(opts.headers);
  USER_AGENT && !headers.has("User-Agent") && headers.set("User-Agent", USER_AGENT), headers.has("accept") || headers.set("accept", "application/json, application/jwk-set+json");
  const fetchImpl = opts[customFetch], cache2 = opts[jwksCache];
  let jwksTimestamp, pendingFetch, reloadSequence = 0, appliedSequence = 0, local;
  if (cache2 && typeof cache2 == "object") {
    const { uat, jwks } = cache2;
    isFreshFor(uat, cacheMaxAge) && isJwkSet(jwks) && (jwksTimestamp = uat, local = createLocalJWKSet(jwks));
  }
  const reload = /* @__PURE__ */ __name(async () => {
    if (pendingFetch && isCloudflareWorkers() && (pendingFetch = void 0), !pendingFetch) {
      const sequence = ++reloadSequence, current = pendingFetch = fetchJwks(href, headers, AbortSignal.timeout(timeoutDuration), fetchImpl).then((json2) => {
        const next = createLocalJWKSet(json2);
        if (sequence <= appliedSequence)
          return;
        local = next;
        const updatedAt = Date.now();
        cache2 && (cache2.uat = updatedAt, cache2.jwks = json2), jwksTimestamp = updatedAt, appliedSequence = sequence;
      }).finally(() => {
        pendingFetch === current && (pendingFetch = void 0);
      });
    }
    await pendingFetch;
  }, "reload");
  return Object.defineProperties(async (protectedHeader, token) => {
    (!local || !isFreshFor(jwksTimestamp, cacheMaxAge)) && await reload();
    try {
      return await local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey && !isFreshFor(jwksTimestamp, cooldownDuration))
        return await reload(), local(protectedHeader, token);
      throw err;
    }
  }, {
    coolingDown: {
      get: /* @__PURE__ */ __name(() => isFreshFor(jwksTimestamp, cooldownDuration), "get"),
      enumerable: true
    },
    fresh: {
      get: /* @__PURE__ */ __name(() => isFreshFor(jwksTimestamp, cacheMaxAge), "get"),
      enumerable: true
    },
    reload: {
      value: reload,
      enumerable: true
    },
    reloading: {
      get: /* @__PURE__ */ __name(() => !!pendingFetch, "get"),
      enumerable: true
    },
    jwks: {
      value: /* @__PURE__ */ __name(() => local?.jwks(), "value"),
      enumerable: true
    }
  });
}
__name(createRemoteJWKSet, "createRemoteJWKSet");

// worker/access.ts
var keySets = /* @__PURE__ */ new Map();
async function verifyAccessToken(token, config, keyOverride) {
  const team = config.ACCESS_TEAM_DOMAIN;
  const aud = config.ACCESS_AUD;
  if (!team || !aud || !/^([a-z0-9-]+)\.cloudflareaccess\.com$/.test(team))
    throw new Error("Access configuration missing");
  let keys = keyOverride || keySets.get(team);
  if (!keys) {
    const remote = createRemoteJWKSet(
      new URL(`https://${team}/cdn-cgi/access/certs`)
    );
    keySets.set(team, remote);
    keys = remote;
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer: `https://${team}`,
    audience: aud,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email"]
  });
  if (typeof payload.email !== "string" || !payload.email.includes("@"))
    throw new Error("Invalid Access identity");
  return payload.email;
}
__name(verifyAccessToken, "verifyAccessToken");

// worker/profile.ts
function result(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(result, "result");
async function publicProfile(env) {
  const fallback = await repository.getProfile();
  const row = await env.DB.prepare(
    "SELECT nickname,bio,location,avatar_id,updated_at FROM profile WHERE id=1"
  ).first();
  return {
    name: row?.nickname || fallback.name,
    bio: row?.bio ?? fallback.bio,
    location: row?.location ?? fallback.location,
    handle: fallback.handle,
    avatarUrl: row?.avatar_id ? `/api/avatars/${row.avatar_id}` : "/media/avatar.svg",
    updatedAt: row?.updated_at ?? null
  };
}
__name(publicProfile, "publicProfile");
async function profileRoute(request, env) {
  const url = new URL(request.url);
  const admin = url.pathname === "/api/admin/profile";
  const avatar = url.pathname.match(/^\/api\/avatars\/([a-f0-9-]{36})$/);
  if (url.pathname !== "/api/profile" && !admin && !avatar) return null;
  if (admin) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token)
      return result({ error: "\u8BF7\u5148\u901A\u8FC7 Cloudflare Access \u767B\u5F55\u3002" }, 401);
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
      return result({ error: "\u7BA1\u7406\u5458\u767B\u5F55\u5C1A\u672A\u914D\u7F6E\u3002" }, 503);
    try {
      await verifyAccessToken(token, env);
    } catch {
      return result({ error: "\u767B\u5F55\u5DF2\u5931\u6548\u6216\u65E0\u6743\u8BBF\u95EE\u3002" }, 403);
    }
  }
  if (!env.DB) return result({ error: "\u8D44\u6599\u5B58\u50A8\u5C1A\u672A\u914D\u7F6E\u3002" }, 503);
  try {
    if (avatar) {
      if (request.method !== "GET")
        return result({ error: "\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301\u3002" }, 405);
      const row = await env.DB.prepare(
        "SELECT mime_type,bytes FROM avatars WHERE id=?"
      ).bind(avatar[1]).first();
      if (!row) return result({ error: "\u5934\u50CF\u4E0D\u5B58\u5728\u3002" }, 404);
      return new Response(new Uint8Array(row.bytes), {
        headers: {
          "Content-Type": row.mime_type,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    if (request.method === "GET") return result(await publicProfile(env));
    if (!admin || request.method !== "POST")
      return result({ error: "\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301\u3002" }, 405);
    if (request.headers.get("Origin") !== url.origin)
      return result({ error: "\u8BF7\u6C42\u6765\u6E90\u65E0\u6548\u3002" }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data"))
      return result({ error: "\u4E0A\u4F20\u683C\u5F0F\u65E0\u6548\u3002" }, 415);
    const declared = Number(request.headers.get("Content-Length"));
    if (declared > 24e4) return result({ error: "\u4E0A\u4F20\u6587\u4EF6\u8FC7\u5927\u3002" }, 413);
    const reader = request.body?.getReader();
    if (!reader) return result({ error: "\u8BF7\u6C42\u4E3A\u7A7A\u3002" }, 400);
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 24e4) {
        await reader.cancel();
        return result({ error: "\u4E0A\u4F20\u6587\u4EF6\u8FC7\u5927\u3002" }, 413);
      }
      chunks.push(value);
    }
    const payload = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.length;
    }
    const form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: payload
    }).formData();
    const nickname = form.get("nickname");
    const bio = form.get("bio");
    const location = form.get("location");
    if (typeof nickname !== "string" || !nickname.trim() || [...nickname.trim()].length > 40 || typeof bio !== "string" || [...bio].length > 160 || typeof location !== "string" || [...location].length > 80)
      return result(
        { error: "\u6635\u79F0\u9700 1\u201340 \u5B57\uFF0C\u7B80\u4ECB\u6700\u591A 160 \u5B57\uFF0C\u4F4D\u7F6E\u6700\u591A 80 \u5B57\u3002" },
        400
      );
    const removeAvatar = form.get("removeAvatar") === "true";
    const file = form.get("avatar");
    let avatarId = removeAvatar ? null : void 0;
    const statements = [];
    if (file && typeof file !== "string" && file.size) {
      if (file.size > 200 * 1024)
        return result({ error: "\u5934\u50CF\u4E0D\u80FD\u8D85\u8FC7 200 KB\u3002" }, 413);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let size;
      try {
        size = imageSize(bytes);
      } catch {
        return result({ error: "\u56FE\u7247\u65E0\u6CD5\u8BC6\u522B\uFF0C\u8BF7\u6362\u4E00\u5F20\u56FE\u7247\u3002" }, 400);
      }
      const types2 = {
        jpg: "image/jpeg",
        png: "image/png",
        webp: "image/webp"
      };
      if (!size.type || !types2[size.type] || file.type !== types2[size.type] || !size.width || !size.height || size.width > 1024 || size.height > 1024 || size.width < 16 || size.height < 16)
        return result(
          { error: "\u4EC5\u652F\u6301 16\u20131024 \u50CF\u7D20\u7684 JPEG\u3001PNG\u3001WebP \u56FE\u7247\u3002" },
          400
        );
      avatarId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          "INSERT INTO avatars(id,mime_type,width,height,bytes,created_at) VALUES(?,?,?,?,?,?)"
        ).bind(
          avatarId,
          types2[size.type],
          size.width,
          size.height,
          bytes,
          (/* @__PURE__ */ new Date()).toISOString()
        )
      );
    }
    const previous = await env.DB.prepare(
      "SELECT avatar_id FROM profile WHERE id=1"
    ).first();
    const nextAvatar = avatarId === void 0 ? previous?.avatar_id ?? null : avatarId;
    statements.push(
      env.DB.prepare(
        "INSERT INTO profile(id,nickname,bio,location,avatar_id,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,bio=excluded.bio,location=excluded.location,avatar_id=excluded.avatar_id,updated_at=excluded.updated_at"
      ).bind(
        nickname.trim(),
        bio,
        location,
        nextAvatar,
        (/* @__PURE__ */ new Date()).toISOString()
      )
    );
    await env.DB.batch(statements);
    return result(await publicProfile(env));
  } catch (error) {
    console.error(
      "profile operation failed",
      error instanceof Error ? error.message : "unknown"
    );
    return result({ error: "\u8D44\u6599\u4FDD\u5B58\u6216\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" }, 503);
  }
}
__name(profileRoute, "profileRoute");

// worker/index.ts
var cookieName = "space_visitor";
var HttpError = class extends Error {
  constructor(status, message2) {
    super(message2);
    this.status = status;
  }
  status;
  static {
    __name(this, "HttpError");
  }
};
function json(data, status = 200, cookie) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
__name(json, "json");
async function hash(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    )
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hash, "hash");
async function visitor(request, db, create2) {
  const token = (request.headers.get("Cookie") || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  const now = Math.floor(Date.now() / 1e3);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const id2 = await hash(token);
    if (await db.prepare("SELECT id FROM visitors WHERE id=? AND expires_at>?").bind(id2, now).first())
      return { id: id2 };
  }
  if (!create2) throw new HttpError(403, "\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5\u3002");
  const next = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const id = await hash(next);
  await db.prepare("INSERT INTO visitors(id,expires_at) VALUES(?,?)").bind(id, now + 90 * 86400).run();
  const local = ["localhost", "127.0.0.1"].includes(
    new URL(request.url).hostname
  );
  return {
    id,
    cookie: `${cookieName}=${next}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${local ? "" : "; Secure"}`
  };
}
__name(visitor, "visitor");
async function limit(db, id) {
  const result2 = await db.prepare(
    "INSERT INTO rate_limits(visitor_id,window,count) VALUES(?,?,1) ON CONFLICT(visitor_id) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window WHERE window<>excluded.window OR count<60 RETURNING count"
  ).bind(id, Math.floor(Date.now() / 6e4)).first();
  if (!result2) throw new HttpError(429, "\u64CD\u4F5C\u592A\u9891\u7E41\u3002");
}
__name(limit, "limit");
async function stats(db, id, visitorId) {
  const row = await db.prepare(
    "SELECT s.views,s.likes,s.dislikes,COALESCE(v.value,0) AS myVote FROM post_stats s LEFT JOIN votes v ON v.post_id=s.post_id AND v.visitor_id=? WHERE s.post_id=?"
  ).bind(visitorId, id).first();
  return {
    postId: id,
    views: row?.views ?? 0,
    likes: row?.likes ?? 0,
    dislikes: row?.dislikes ?? 0,
    myVote: row?.myVote ?? 0
  };
}
__name(stats, "stats");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const profileResponse = await profileRoute(request, env);
    if (profileResponse) return profileResponse;
    let session;
    try {
      const list = url.pathname === "/api/engagement";
      const match = url.pathname.match(
        /^\/api\/engagement\/([a-z0-9-]+)\/(view|vote)$/
      );
      if (!list && !match) throw new HttpError(404, "\u63A5\u53E3\u4E0D\u5B58\u5728\u3002");
      if (list && request.method !== "GET" || match && request.method !== "POST")
        throw new HttpError(405, "\u8BF7\u6C42\u65B9\u6CD5\u4E0D\u652F\u6301\u3002");
      const ids = list ? (url.searchParams.get("ids") || "").split(",") : [match[1]];
      if (ids.length > 20 || !ids.length || ids.some((id2) => !id2 || id2.length > 100))
        throw new HttpError(400, "\u5185\u5BB9\u53C2\u6570\u65E0\u6548\u3002");
      for (const id2 of ids)
        if (!await repository.getPublished(id2))
          throw new HttpError(404, "\u5185\u5BB9\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u516C\u5F00\u3002");
      if (!env.DB) throw new HttpError(503, "\u7EDF\u8BA1\u670D\u52A1\u672A\u914D\u7F6E\u3002");
      if (match) {
        if (request.headers.get("Origin") !== url.origin)
          throw new HttpError(403, "\u8BF7\u6C42\u6765\u6E90\u65E0\u6548\u3002");
        if (!request.headers.get("Content-Type")?.startsWith("application/json"))
          throw new HttpError(415, "\u9700\u8981 JSON \u8BF7\u6C42\u3002");
      }
      session = await visitor(request, env.DB, list);
      await limit(env.DB, session.id);
      if (list)
        return json(
          await Promise.all(ids.map((id2) => stats(env.DB, id2, session.id))),
          200,
          session.cookie
        );
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 1024)
        throw new HttpError(413, "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927\u3002");
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, "JSON \u65E0\u6548\u3002");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new HttpError(400, "\u8BF7\u6C42\u5185\u5BB9\u65E0\u6548\u3002");
      const id = match[1];
      if (match[2] === "view") {
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(/* @__PURE__ */ new Date());
        await env.DB.prepare(
          "INSERT INTO views(post_id,visitor_id,day) VALUES(?,?,?) ON CONFLICT DO NOTHING"
        ).bind(id, session.id, day).run();
      } else {
        if (![-1, 0, 1].includes(body.vote) || typeof body.vote !== "number")
          throw new HttpError(400, "\u8BC4\u4EF7\u65E0\u6548\u3002");
        if (body.vote === 0)
          await env.DB.prepare(
            "DELETE FROM votes WHERE post_id=? AND visitor_id=?"
          ).bind(id, session.id).run();
        else
          await env.DB.prepare(
            "INSERT INTO votes(post_id,visitor_id,value) VALUES(?,?,?) ON CONFLICT(post_id,visitor_id) DO UPDATE SET value=excluded.value"
          ).bind(id, session.id, body.vote).run();
      }
      return json(await stats(env.DB, id, session.id), 200, session.cookie);
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status, session?.cookie);
      console.error(
        "engagement request failed",
        error instanceof Error ? error.message : "unknown"
      );
      return json({ error: "\u7EDF\u8BA1\u670D\u52A1\u6682\u4E0D\u53EF\u7528\u3002" }, 503, session?.cookie);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-O3b8Ve/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-O3b8Ve/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
