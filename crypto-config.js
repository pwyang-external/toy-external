// GitHub 설정(owner/repo/token 등)을 패스프레이즈로 암호화/복호화하는 공통 모듈.
// AES-256-GCM + PBKDF2(200,000회)로 파생한 키를 사용합니다.
// 암호화된 결과(salt/iv/ciphertext)는 패스프레이즈 없이는 의미 없는 값이라 git에 커밋해도 안전합니다.

const PBKDF2_ITERATIONS = 200000;

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

async function deriveAesKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// config(객체)를 암호화해서 { salt, iv, ciphertext } (모두 base64) 형태로 반환
async function encryptConfig(config, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const enc = new TextEncoder();
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(config))
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf))
  };
}

// { salt, iv, ciphertext }와 passphrase로 원래 config 객체를 복원.
// 암호가 틀리거나 파일이 손상되면 예외를 던짐 (AES-GCM 인증 태그 검증 실패).
async function decryptConfig(blob, passphrase) {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const key = await deriveAesKey(passphrase, salt);
  const ciphertextBytes = base64ToBytes(blob.ciphertext);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextBytes);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}
