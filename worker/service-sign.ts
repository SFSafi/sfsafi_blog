export async function signBody(
  secret: string,
  timestamp: string,
  body: string,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(timestamp + '.' + body),
    ),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyBody(
  secret: string,
  timestamp: string | null,
  body: string,
  signature: string | null,
) {
  if (
    !timestamp ||
    !/^\d{10,11}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(signature.match(/../g)!.map((v) => parseInt(v, 16))),
    new TextEncoder().encode(timestamp + '.' + body),
  );
}
