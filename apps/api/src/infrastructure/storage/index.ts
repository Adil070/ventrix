import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'fs';
import { config } from '../../config';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export const s3Client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
});

export class StorageService {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    this.bucket = config.S3_BUCKET;
    this.client = s3Client;
  }

  async uploadBuffer(
    buffer: Buffer,
    options: {
      folder?: string;
      filename?: string;
      mimeType?: string;
      organizationId?: string;
    }
  ): Promise<{ key: string; url: string; size: number }> {
    const ext = options.filename ? path.extname(options.filename) : '';
    const key = [
      options.organizationId,
      options.folder || 'uploads',
      `${uuidv4()}${ext}`,
    ]
      .filter(Boolean)
      .join('/');

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: options.mimeType || 'application/octet-stream',
        Metadata: {
          originalName: options.filename || '',
          organizationId: options.organizationId || '',
        },
      })
    );

    const url = `${config.S3_ENDPOINT}/${this.bucket}/${key}`;

    logger.debug({ key, size: buffer.length }, 'File uploaded to S3');

    return { key, url, size: buffer.length };
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    logger.debug({ key }, 'File deleted from S3');
  }

  async copyFile(sourceKey: string, destinationKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destinationKey,
      })
    );
  }

  getPublicUrl(key: string): string {
    return `${config.S3_ENDPOINT}/${this.bucket}/${key}`;
  }

  // Folder structure helpers
  static paths = {
    logo: (orgId: string) => `${orgId}/logos`,
    invoice: (orgId: string) => `${orgId}/invoices`,
    purchase: (orgId: string) => `${orgId}/purchases`,
    product: (orgId: string) => `${orgId}/products`,
    document: (orgId: string) => `${orgId}/documents`,
    expense: (orgId: string) => `${orgId}/expenses`,
    avatar: (userId: string) => `users/${userId}/avatar`,
  };
}

export const storage = new StorageService();
