export interface ContentRuntime {
  id(): string;
  now(): string;
  hash(value: string): string;
  decodeBase64(value: string): Uint8Array;
  encodeBase64(value: Uint8Array): string;
}
