const sharp = require('sharp');
const { HttpError } = require('./store.cjs');
async function readPhoto(req) {
  if (req.headers['content-type'] !== 'application/octet-stream') throw new HttpError(415, '请上传图片文件');
  const limit = 8 * 1024 * 1024;
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, '照片不能超过8MB');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '照片不能超过8MB');
    chunks.push(chunk);
  }
  try {
    const input = Buffer.concat(chunks);
    const options = { limitInputPixels: 40000000, failOn: 'warning' };
    const metadata = await sharp(input, options).metadata();
    if (!['jpeg', 'png', 'webp', 'heif'].includes(metadata.format) || metadata.pages > 1) throw new Error();
    // Re-encode to strip GPS/EXIF and reject scripts or disguised non-image uploads.
    return await sharp(input, options)
      .rotate()
      .resize({ width: 750, height: 750, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new HttpError(400, '照片无法读取，请选择普通照片后重试');
  }
}
module.exports = { readPhoto };
