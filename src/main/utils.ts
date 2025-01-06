import * as fs from 'fs';
import * as path from 'path';
import { BrowserConfig } from './types';

export function generateUserAgent(): string {
  const chromeVersions = ['114.0.0.0', '115.0.0.0', '116.0.0.0', '117.0.0.0', '118.0.0.0', '119.0.0.0'];
  const platforms = {
    win: {
      os: 'Windows NT 10.0; Win64; x64',
      platform: 'Windows'
    },
    mac: {
      os: 'Macintosh; Intel Mac OS X 10_15_7',
      platform: 'macOS'
    },
    linux: {
      os: 'X11; Linux x86_64',
      platform: 'Linux'
    }
  } as const;

  const randomChrome = chromeVersions[Math.floor(Math.random() * chromeVersions.length)];
  const platformKeys = ['win', 'mac', 'linux'] as const;
  const randomPlatform = platforms[platformKeys[Math.floor(Math.random() * platformKeys.length)] as keyof typeof platforms];

  return `Mozilla/5.0 (${randomPlatform.os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${randomChrome} Safari/537.36`;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 2000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);
}

export function getChromePath(customPath?: string): string {
  // 如果提供了自定义路径且路径存在，优先使用自定义路径
  if (customPath) {
    try {
      const stats = fs.statSync(customPath);
      if (stats.isFile()) {
        if (process.platform !== 'win32') {
          const mode = stats.mode;
          if ((mode & 0o111) !== 0) {
            console.debug(`Using custom Chrome path: ${customPath}`);
            return customPath;
          }
        } else {
          console.debug(`Using custom Chrome path: ${customPath}`);
          return customPath;
        }
      }
    } catch (error) {
      console.debug(`Custom Chrome path not valid: ${customPath}`);
    }
  }

  // 默认路径查找
  const platform = process.platform;
  let paths: string[] = [];

  switch (platform) {
    case 'win32':
      paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
      ];
      break;
    case 'darwin':
      paths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(process.env.HOME || '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ];
      break;
    case 'linux':
      paths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
      ];
      break;
  }

  // 验证每个路径
  for (const chromePath of paths) {
    try {
      const stats = fs.statSync(chromePath);
      if (stats.isFile()) {
        if (platform !== 'win32') {
          const mode = stats.mode;
          if ((mode & 0o111) !== 0) {
            console.debug(`Found executable Chrome at: ${chromePath}`);
            return chromePath;
          }
        } else {
          console.debug(`Found Chrome at: ${chromePath}`);
          return chromePath;
        }
      }
    } catch (error) {
      console.debug(`Chrome not found at: ${chromePath}`);
      continue;
    }
  }

  throw new Error('找不到Chrome浏览器，请确保已安装Google Chrome或提供正确的安装路径');
}

export function cleanUserDataDirectory(userDataDir: string) {
  try {
    const filesToClean = [
      'SingletonLock',
      'SingletonSocket',
      'Singleton'
    ];

    for (const file of filesToClean) {
      const filePath = path.join(userDataDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (error) {
    console.error('Failed to clean user data directory:', error);
  }
}

export function validateBrowserConfig(config: BrowserConfig): boolean {
  if (!config) return false;
  if (typeof config.id !== 'string' || !config.id.trim()) return false;
  if (typeof config.name !== 'string' || !config.name.trim()) return false;
  
  // 检查ID格式
  if (!/^\d+$/.test(config.id)) return false;
  
  // 检查名称长度
  if (config.name.length > 50) return false;
  
  return true;
} 