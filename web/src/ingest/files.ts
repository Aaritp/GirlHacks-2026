import { MAX_FILE_BYTES } from './contracts';

export async function encodeUpload(file: File): Promise<string> {
  if (!/\.(txt|md|pdf)$/i.test(file.name)) throw new Error('Choose a .txt, .md or text-based .pdf file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file no larger than 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
