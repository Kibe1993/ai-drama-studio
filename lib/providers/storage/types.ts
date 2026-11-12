export type StorageProviderId = "local" | "s3" | "cloudinary";

export type StoredObject = {
  key: string;
  byteSize: number;
  sha256: string;
  contentType: string;
};

export type StoredObjectInfo = {
  key: string;
  byteSize: number;
  lastModified: Date;
};

export type StorageProvider = {
  readonly id: StorageProviderId;
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  openRead(key: string): Promise<ReadableStream<Uint8Array>>;
  stat(key: string): Promise<{ byteSize: number } | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObjectInfo[]>;
};
