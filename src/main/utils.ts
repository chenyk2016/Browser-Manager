import * as fs from 'fs';
import * as path from 'path';
import { BrowserConfig } from './types';

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 2000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);
}

export function getChromePath(): string {
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
      // 检查文件是否存在且可执行
      const stats = fs.statSync(chromePath);
      if (stats.isFile()) {
        // 在macOS和Linux上检查可执行权限
        if (platform !== 'win32') {
          const mode = stats.mode;
          if ((mode & 0o111) !== 0) { // 检查是否有执行权限
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

  throw new Error('找不到Chrome浏览器，请确保已安装Google Chrome');
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