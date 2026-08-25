import {createObjectStorageS3Clients} from './client.js';
import type {ObjectStorageS3Profile} from './config.js';

const profile: ObjectStorageS3Profile = {
  endpoint: 'https://objects.example.test',
  region: 'test-region',
  bucket: 'test-bucket',
  credentials: {accessKeyId: 'explicit-access', secretAccessKey: 'explicit-secret'},
  forcePathStyle: true,
};

describe('createObjectStorageS3Clients', () => {
  it('uses the explicit credentials for control and transfer clients', async () => {
    const clients = createObjectStorageS3Clients(profile);

    const credentials = await Promise.all([
      clients.control.config.credentials(),
      clients.transfer.config.credentials(),
    ]);

    expect(credentials).toEqual([
      expect.objectContaining({accessKeyId: 'explicit-access', secretAccessKey: 'explicit-secret'}),
      expect.objectContaining({accessKeyId: 'explicit-access', secretAccessKey: 'explicit-secret'}),
    ]);
    clients.control.destroy();
    clients.transfer.destroy();
  });
});
