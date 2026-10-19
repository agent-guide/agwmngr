export interface ContentRuntime {
  id(): string;
  now(): string;
  hash(value: string): string;
  hashBytes(value: Uint8Array): string;
  decodeBase64(value: string): Uint8Array;
  encodeBase64(value: Uint8Array): string;
}
