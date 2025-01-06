import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { browserManager } from './browserManager';

// 获取应用根目录
const APP_PATH = app.isPackaged 
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '../..');

console.log('Main process started - Testing hot reload');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('APP_PATH:', APP_PATH);

// 在开发环境中启用热重载
try {
  if (process.env.NODE_ENV === 'development') {
    console.log('Enabling electron-reloader...');
    const reloader = require('electron-reloader');
    reloader(module, {
      debug: true,
      watchRenderer: false,
      ignore: [
        /node_modules|[/\\]\./,
        /src[/\\]renderer/
      ]
    });
    console.log('Electron reloader configured');
  }
} catch (err) {
  console.error('Failed to enable electron-reloader:', err);
}

// 主窗口引用
let mainWindow: BrowserWindow | null = null;

// 设置IPC处理器
function setupIpcHandlers() {
  // 获取浏览器配置列表
  ipcMain.handle('get-browser-configs', async () => {
    try {
      return browserManager.getAllConfigs();
    } catch (error) {
      console.error('Failed to get browser configs:', error);
      return { success: false, error: error instanceof Error ? error.message : '获取浏览器配置失败' };
    }
  });

  // 保存浏览器配置
  ipcMain.handle('save-browser-config', async (event, config) => {
    try {
      if (!config || typeof config !== 'object') {
        throw new Error('无效的配置数据');
      }
      browserManager.saveConfig(config);
      return { success: true };
    } catch (error) {
      console.error('Failed to save browser config:', error);
      return { success: false, error: error instanceof Error ? error.message : '保存浏览器配置失败' };
    }
  });

  // 删除浏览器配置
  ipcMain.handle('delete-browser-config', async (event, id) => {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('无效的配置ID');
      }
      browserManager.deleteConfig(id);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete browser config:', error);
      return { success: false, error: error instanceof Error ? error.message : '删除浏览器配置失败' };
    }
  });

  // 启动浏览器实例
  ipcMain.handle('launch-browser', async (event, config) => {
    try {
      if (!config || typeof config !== 'object') {
        throw new Error('无效的配置数据');
      }
      await browserManager.launchBrowser(config);
      return { success: true, id: config.id };
    } catch (error) {
      console.error('Failed to launch browser:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '启动浏览器失败'
      };
    }
  });

  // 停止浏览器实例
  ipcMain.handle('stop-browser', async (event, id) => {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('无效的实例ID');
      }
      await browserManager.stopBrowser(id);
      return { success: true };
    } catch (error) {
      console.error('Failed to stop browser:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '停止浏览器失败'
      };
    }
  });

  // 获取浏览器状态
  ipcMain.handle('get-browser-status', (event, id) => {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('无效的实例ID');
      }
      const status = browserManager.getBrowserStatus(id);
      return status || { isRunning: false, lastChecked: Date.now(), inProgress: false };
    } catch (error) {
      console.error('Failed to get browser status:', error);
      return { isRunning: false, lastChecked: Date.now(), inProgress: false };
    }
  });

  // 获取所有浏览器状态
  ipcMain.handle('get-all-browser-statuses', () => {
    try {
      const statusMap = browserManager.getAllBrowserStatuses();
      // 将Map转换为普通对象以确保IPC传输正确
      const statusObj: { [key: string]: any } = {};
      statusMap.forEach((status, id) => {
        statusObj[id] = {
          isRunning: Boolean(status.isRunning),
          lastChecked: Number(status.lastChecked),
          inProgress: Boolean(status.inProgress),
          action: status.action
        };
      });
      return statusObj;
    } catch (error) {
      console.error('Failed to get all browser statuses:', error);
      return {};
    }
  });

  // 设置状态更新事件转发
  browserManager.on('statusUpdate', (id: string, status: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-status-update', id, status);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true
    },
    icon: path.join(APP_PATH, 'build/icon.png')
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:8080').catch(err => {
      console.error('Failed to load development server:', err);
      dialog.showErrorBox('加载错误', '无法连接到开发服务器，请确保开发服务器已启动。');
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch(err => {
      console.error('Failed to load app:', err);
      dialog.showErrorBox('加载错误', '应用加载失败，请检查文件是否完整。');
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 处理渲染进程崩溃
  mainWindow.webContents.on('crashed', () => {
    dialog.showErrorBox('错误', '渲染进程崩溃，请重启应用。');
    app.quit();
  });
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  dialog.showErrorBox('错误', '发生未知错误，请重启应用。');
  app.exit(1);
});

// 初始化应用
app.whenReady().then(() => {
  // 先设置IPC处理器
  setupIpcHandlers();
  // 然后创建窗口
  createWindow();

  // 设置退出处理
  let isQuitting = false;
  let quitTimeout: NodeJS.Timeout;

  app.on('before-quit', async (event) => {
    // 如果已经在退出过程中,直接返回
    if (isQuitting) return;

    console.log('Preparing to quit...');
    event.preventDefault();
    isQuitting = true;

    // 设置超时强制退出
    quitTimeout = setTimeout(() => {
      console.log('Force quitting due to timeout...');
      app.exit(0);
    }, 3000);

    try {
      // 清理所有浏览器实例
      await browserManager.stopAllBrowsers();
      console.log('All browsers stopped, quitting...');
      
      // 清除超时
      clearTimeout(quitTimeout);
      app.exit(0);
    } catch (error) {
      console.error('Error during cleanup:', error);
      clearTimeout(quitTimeout);
      app.exit(1);
    }
  });

}).catch(err => {
  console.error('Failed to initialize app:', err);
  dialog.showErrorBox('启动错误', '应用启动失败，请重试。');
  app.exit(1);
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// 确保在退出前清理资源
app.on('will-quit', () => {
  console.log('Application will quit');
}); 