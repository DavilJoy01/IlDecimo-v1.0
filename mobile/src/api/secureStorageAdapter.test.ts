import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { secureStorageAdapter } from './secureStorageAdapter';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('secureStorageAdapter on native platforms', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });
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

describe('secureStorageAdapter on web, with a real window (browser tab)', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Platform.OS = 'web';
    const store = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
      // Minimal Storage/Window stand-in for this test only -- real DOM types
      // aren't relevant here.
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    Platform.OS = 'ios';
    globalThis.window = originalWindow;
    jest.clearAllMocks();
  });

  it('reads a value through window.localStorage, never through SecureStore', async () => {
    globalThis.window.localStorage.setItem('my-key', 'stored-value');
    const result = await secureStorageAdapter.getItem('my-key');
    expect(result).toBe('stored-value');
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('writes a value through window.localStorage, never through SecureStore', async () => {
    await secureStorageAdapter.setItem('my-key', 'my-value');
    expect(globalThis.window.localStorage.getItem('my-key')).toBe('my-value');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('removes a value through window.localStorage, never through SecureStore', async () => {
    globalThis.window.localStorage.setItem('my-key', 'my-value');
    await secureStorageAdapter.removeItem('my-key');
    expect(globalThis.window.localStorage.getItem('my-key')).toBeNull();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe('secureStorageAdapter on web, with no window at all (Node/SSR prerendering)', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Platform.OS = 'web';
    // @ts-expect-error -- simulating the Node SSR render pass, which has no DOM globals.
    delete globalThis.window;
  });

  afterEach(() => {
    Platform.OS = 'ios';
    globalThis.window = originalWindow;
    jest.clearAllMocks();
  });

  it('getItem resolves null instead of throwing', async () => {
    await expect(secureStorageAdapter.getItem('my-key')).resolves.toBeNull();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('setItem resolves without throwing', async () => {
    await expect(secureStorageAdapter.setItem('my-key', 'my-value')).resolves.toBeUndefined();
  });

  it('removeItem resolves without throwing', async () => {
    await expect(secureStorageAdapter.removeItem('my-key')).resolves.toBeUndefined();
  });
});
