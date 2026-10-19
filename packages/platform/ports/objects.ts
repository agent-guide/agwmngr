export interface StoredObjectInfo {
  sizeBytes: number;
  contentHash: string;
}

export class ObjectStoreConflictError extends Error {
  constructor(message = "immutable object key already contains different bytes") {
    super(message);
    this.name = "ObjectStoreConflictError";
  }
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<StoredObjectInfo>;
  stat(key: string): Promise<StoredObjectInfo | null>;
  read(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
