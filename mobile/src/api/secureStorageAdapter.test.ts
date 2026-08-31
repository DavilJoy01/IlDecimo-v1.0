import * as SecureStore from 'expo-secure-store';
import { secureStorageAdapter } from './secureStorageAdapter';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('secureStorageAdapter', () => {
  afterEach(() => jest.clearAllMocks());

  it('reads a value through SecureStore.getItemAsync', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-value');
    const result = await secureStorageAdapter.getItem('my-key');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('my-key');
    expect(result).toBe('stored-value');
  });

  it('writes a value through SecureStore.setItemAsync', async () => {
    await secureStorageAdapter.setItem('my-key', 'my-value');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('my-key', 'my-value');
  });

  it('removes a value through SecureStore.deleteItemAsync', async () => {
    await secureStorageAdapter.removeItem('my-key');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('my-key');
  });
});
