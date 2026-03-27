const { encrypt, decrypt, encryptJson, decryptJson } = require('../../src/crypto');

describe('crypto', () => {
  const VALID_KEY = 'a'.repeat(64);

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  test('encrypt_andDecrypt_roundTrip_returnsOriginalString', () => {
    const plaintext = 'Hello, world!';
    const ciphertext = encrypt(plaintext);
    const result = decrypt(ciphertext);
    expect(result).toBe(plaintext);
  });

  test('encryptJson_andDecryptJson_roundTrip_returnsOriginalObject', () => {
    const obj = { name: 'test', count: 42, nested: { flag: true } };
    const ciphertext = encryptJson(obj);
    const result = decryptJson(ciphertext);
    expect(result).toEqual(obj);
  });

  test('decrypt_withTamperedCiphertext_throwsError', () => {
    const ciphertext = encrypt('secret data');
    const buf = Buffer.from(ciphertext, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip last byte
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  test('encrypt_whenEncryptionKeyMissing_throwsError', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY');
  });

  test('encrypt_whenEncryptionKeyInvalidFormat_throwsError', () => {
    process.env.ENCRYPTION_KEY = 'not-hex';
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY');
  });
});
