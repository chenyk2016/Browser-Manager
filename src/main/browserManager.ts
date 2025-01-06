import puppeteer, { Browser } from 'puppeteer-core';
import { dialog, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { BrowserConfig, BrowserInstance, BrowserStatus } from './types';
import { withTimeout, getChromePath, cleanUserDataDirectory, validateBrowserConfig } from './utils';

class BrowserManager extends EventEmitter {
  private instances: Map<string, BrowserInstance> = new Map();
  private configs: Map<string, BrowserConfig> = new Map();
  private isShuttingDown = false;
  private readonly userDataBasePath: string;
  private readonly configPath: string;
  private statusCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    console.log('BrowserManager initialized - Testing hot reload');
    this.testHotReload();
    
    this.userDataBasePath = path.join(app.getPath('userData'), 'browser-instances');
    this.configPath = path.join(app.getPath('userData'), 'browser-configs.json');
    this.ensureUserDataDirectory();
    this.loadConfigs();
    this.startStatusCheck();

    // 监听应用退出事件
    app.on('before-quit', async (event) => {
      // 如果正在关闭,阻止退出
      if (this.isShuttingDown) {
        event.preventDefault();
        return;
      }

      // 标记正在关闭
      this.isShuttingDown = true;
      event.preventDefault();

      console.log('Cleaning up before quit...');
      
      // 停止状态检查
      if (this.statusCheckInterval) {
        clearInterval(this.statusCheckInterval);
        this.statusCheckInterval = null;
      }

      try {
        // 保存所有配置
        this.saveConfigs();
        
        // 停止所有浏览器实例
        await this.stopAllBrowsers();
        
        console.log('Cleanup completed, quitting app...');
        app.quit();
      } catch (error) {
        console.error('Failed to cleanup:', error);
        this.isShuttingDown = false;
        dialog.showErrorBox('清理失败', '应用退出时清理资源失败，请手动结束进程。');
      }
    });

    // 开发环境下的额外处理
    if (process.env.NODE_ENV === 'development') {
      // 监听文件变化导致的重启
      process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, cleaning up...');
        await this.stopAllBrowsers();
      });
    }
  }

  private startStatusCheck() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
    this.statusCheckInterval = setInterval(() => this.checkAllInstancesStatus(), 2000);
  }

  private async checkAllInstancesStatus() {
    for (const [id, instance] of this.instances) {
      try {
        const isRunning = await this.checkBrowserRunning(instance.browser);
        if (isRunning !== instance.status.isRunning) {
          this.updateInstanceStatus(id, isRunning);
        } else {
          instance.status.lastChecked = Date.now();
          this.emit('statusUpdate', id, instance.status);
        }
      } catch (error) {
        this.updateInstanceStatus(id, false);
      }
    }
  }

  private async checkBrowserRunning(browser: Browser): Promise<boolean> {
    if (!browser) {
      console.debug('Browser is null or undefined');
      return false;
    }

    try {
      // 1. 检查连接状态
      if (!browser.isConnected()) {
        console.debug('Browser not connected');
        return false;
      }
      
      // 2. 检查进程状态
      const process = browser.process();
      if (!process || process.killed) {
        console.debug('Browser process not found or killed');
        return false;
      }

      // 3. 检查页面和目标
      try {
        const pages = await withTimeout(browser.pages())

        const targets = await browser.targets();

        if (!pages || pages.length === 0) {
          console.debug('No pages found');
          // return false;
        }

        if (!targets || targets.length === 0) {
          console.debug('No targets found');
          return false;
        }

        console.debug('Browser is running with pages and targets');
        return true;
      } catch (error) {
        console.debug('Failed to check pages/targets:', error);
        return false;
      }
    } catch (error) {
      console.debug('Failed to check browser status:', error);
      return false;
    }
  }

  private updateInstanceStatus(id: string, isRunning: boolean) {
    const instance = this.instances.get(id);
    if (!instance || instance.status.inProgress) return;

    const prevStatus = instance.status;
    const newStatus: BrowserStatus = {
      isRunning,
      lastChecked: Date.now(),
      inProgress: false
    };
    
    // 记录状态变化
    if (prevStatus.isRunning !== isRunning) {
      console.debug(
        `Browser instance ${id} status changed:`,
        `${prevStatus.isRunning ? 'running' : 'stopped'} -> ${isRunning ? 'running' : 'stopped'}`
      );
    }
    
    instance.status = newStatus;
    
    if (!isRunning && !this.isShuttingDown) {
      this.emit('statusUpdate', id, newStatus);
      this.instances.delete(id);
      this.handleBrowserDisconnect(id);
    } else {
      this.emit('statusUpdate', id, newStatus);
    }
  }

  private ensureUserDataDirectory() {
    if (!fs.existsSync(this.userDataBasePath)) {
      fs.mkdirSync(this.userDataBasePath, { recursive: true });
    }
  }

  private loadConfigs() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const configs = JSON.parse(data) as BrowserConfig[];
        this.configs = new Map(configs.map(config => [config.id, config]));
      }
    } catch (error) {
      console.error('Failed to load configs:', error);
    }
  }

  private saveConfigs() {
    try {
      const configs = Array.from(this.configs.values());
      fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2));
    } catch (error) {
      console.error('Failed to save configs:', error);
      throw new Error('保存配置失败');
    }
  }

  private getUserDataPath(id: string): string {
    return path.join(this.userDataBasePath, id);
  }

  private async cleanupInstance(id: string) {
    console.log(`Cleaning up instance ${id}...`);
    const instance = this.instances.get(id);
    if (!instance) return;

    try {
      if (instance.browser) {
        // 设置清理超时
        const cleanupTimeout = setTimeout(() => {
          console.log(`Cleanup timeout for instance ${id}, forcing close...`);
          try {
            instance.browser.process()?.kill();
          } catch (error) {
            console.error(`Failed to kill browser process ${id}:`, error);
          }
        }, 1000);

        try {
          // 关闭所有页面
          const pages = await instance.browser.pages().catch(() => []);
          await Promise.all(pages.map(page => page.close().catch(() => {})));
          
          // 关闭浏览器
          await instance.browser.close();
          
          clearTimeout(cleanupTimeout);
        } catch (error) {
          console.error(`Error closing browser ${id}:`, error);
          // 如果正常关闭失败，强制结束进程
          try {
            instance.browser.process()?.kill();
          } catch (e) {
            console.error(`Failed to kill browser process ${id}:`, e);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to cleanup browser instance ${id}:`, error);
    } finally {
      // 清理文件系统
      try {
        const userDataDir = this.getUserDataPath(id);
        cleanUserDataDirectory(userDataDir);
      } catch (error) {
        console.error(`Failed to clean user data directory for ${id}:`, error);
      }

      // 从实例列表中移除
      this.instances.delete(id);
      
      // 发送最终状态更新
      this.emit('statusUpdate', id, {
        isRunning: false,
        lastChecked: Date.now(),
        inProgress: false
      });
    }
  }

  private handleBrowserDisconnect(id: string) {
    const config = this.configs.get(id);
    if (config && !this.isShuttingDown) {
      console.log(`Browser instance ${id} disconnected unexpectedly`);
    }
  }

  // Public API
  getAllConfigs(): BrowserConfig[] {
    return Array.from(this.configs.values());
  }

  saveConfig(config: BrowserConfig): void {
    if (!validateBrowserConfig(config)) {
      throw new Error('无效的浏览器配置');
    }

    const existingConfig = Array.from(this.configs.values()).find(c => c.name === config.name);
    if (existingConfig && existingConfig.id !== config.id) {
      throw new Error('实例名称已存在');
    }

    this.configs.set(config.id, config);
    this.saveConfigs();
  }

  deleteConfig(id: string): void {
    if (!id || typeof id !== 'string') {
      throw new Error('无效的配置ID');
    }
    
    if (this.instances.has(id)) {
      throw new Error('无法删除正在运行的实例配置');
    }

    if (!this.configs.has(id)) {
      throw new Error('配置不存在');
    }

    this.configs.delete(id);
    this.saveConfigs();
    
    const userDataDir = this.getUserDataPath(id);
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }

  isInstanceRunning(id: string): boolean {
    return this.instances.get(id)?.status.isRunning || false;
  }

  async launchBrowser(config: BrowserConfig) {
    console.debug(`Attempting to launch browser for config: ${config.id}`);

    // 1. 前置检查
    if (this.isShuttingDown) {
      throw new Error('应用正在关闭，无法启动新的浏览器实例');
    }

    if (this.instances.has(config.id)) {
      throw new Error('浏览器实例已存在');
    }

    if (!this.configs.has(config.id)) {
      throw new Error('找不到浏览器配置');
    }

    // 2. 准备实例
    const userDataDir = this.getUserDataPath(config.id);
    console.debug(`Using user data directory: ${userDataDir}`);

    const instance: BrowserInstance = {
      id: config.id,
      browser: null as any,
      config,
      status: {
        isRunning: false,
        lastChecked: Date.now(),
        inProgress: true,
        action: 'starting'
      }
    };

    this.instances.set(config.id, instance);
    this.emit('statusUpdate', instance.id, instance.status);

    try {
      // 3. 准备用户数据目录
      if (!fs.existsSync(userDataDir)) {
        console.debug(`Creating user data directory: ${userDataDir}`);
        fs.mkdirSync(userDataDir, { recursive: true });
      } else {
        console.debug(`Cleaning existing user data directory: ${userDataDir}`);
        cleanUserDataDirectory(userDataDir);
      }

      // 4. 启动浏览器
      console.debug(`Launching browser with Puppeteer`);
      const chromePath = getChromePath();
      console.debug(`Chrome executable path: ${chromePath}`);
      
      // 验证Chrome路径
      if (!fs.existsSync(chromePath)) {
        throw new Error(`Chrome executable not found at: ${chromePath}`);
      }

      let browser: Browser;
      try {
        browser = await puppeteer.launch({
          executablePath: chromePath,
          userDataDir,
          headless: false,
          defaultViewport: null, // 让窗口大小由操作系统/用户决定
          args: [
            '--disable-dev-shm-usage', // 禁用/dev/shm使用,提高稳定性
            '--disable-gpu', // 禁用GPU硬件加速
            '--no-first-run', // 跳过首次运行向导
            '--disable-notifications', // 禁用通知提示
            '--disable-background-timer-throttling', // 禁用后台计时器限制
            '--disable-backgrounding-occluded-windows', // 禁用窗口遮挡时的后台处理
            '--disable-breakpad', // 禁用崩溃报告
            '--disable-component-extensions-with-background-pages', // 禁用带后台页面的组件扩展
            '--disable-features=TranslateUI', // 禁用翻译提示
            '--disable-renderer-backgrounding', // 禁用渲染器后台处理
            '--autoplay-policy=user-gesture-required', // 要求用户手势才能自动播放
            '--disable-client-side-phishing-detection', // 禁用客户端钓鱼检测
            '--disable-sync', // 禁用Chrome同步功能
            '--no-default-browser-check', // 禁用默认浏览器检查
            '--window-size=1280,720', // 设置默认窗口大小
            '--window-position=50,50', // 设置初始窗口位置
          ],
          ignoreDefaultArgs: ['--enable-automation'], // 隐藏自动化提示
        });

        if (!browser) {
          throw new Error('Browser launch returned null');
        }

        const page = await browser.newPage();
        await page.goto('https://www.baidu.com');

        console.debug('Browser launched successfully');
      } catch (error) {
        console.error('Failed to launch browser:', error);
        throw new Error(
          error instanceof Error 
            ? `启动浏览器失败: ${error.message}` 
            : '启动浏览器失败'
        );
      }

      // 5. 设置实例
      instance.browser = browser;
      console.debug(`Browser launched, waiting for initialization`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 6. 验证启动状态
      console.debug(`Verifying browser status`);
      const isRunning = await this.checkBrowserRunning(browser);
      if (!isRunning) {
        throw new Error('浏览器启动验证失败');
      }

      // 7. 更新状态
      instance.status = {
        isRunning: true,
        lastChecked: Date.now(),
        inProgress: false
      };

      this.emit('statusUpdate', instance.id, instance.status);
      
      // 8. 设置监听器
      browser.on('disconnected', () => {
        console.debug(`Browser instance ${config.id} disconnected`);
        this.updateInstanceStatus(config.id, false);
        cleanUserDataDirectory(userDataDir);
      });

      console.debug(`Browser instance ${config.id} successfully launched`);
      return browser;
    } catch (error) {
      // 9. 错误处理
      console.error(`Failed to launch browser instance ${config.id}:`, error);
      
      this.instances.delete(config.id);
      cleanUserDataDirectory(userDataDir);
      this.emit('statusUpdate', config.id, {
        isRunning: false,
        lastChecked: Date.now(),
        inProgress: false
      });
      
      if (error instanceof Error) {
        throw new Error(`启动浏览器失败: ${error.message}`);
      } else {
        throw new Error('启动浏览器失败');
      }
    }
  }

  async stopBrowser(id: string) {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error('找不到浏览器实例');
    }

    instance.status = {
      ...instance.status,
      inProgress: true,
      action: 'stopping'
    };
    this.emit('statusUpdate', id, instance.status);

    try {
      await this.cleanupInstance(id);
      return true;
    } catch (error) {
      this.instances.delete(id);
      throw new Error(error instanceof Error ? `关闭浏览器失败: ${error.message}` : '关闭浏览器失败');
    }
  }

  async stopAllBrowsers() {
    console.log('Stopping all browsers...');
    this.isShuttingDown = true;
    
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Cleanup timeout')), 2000);
    });

    try {
      // 并行清理所有实例，但添加超时
      await Promise.race([
        Promise.all(
          Array.from(this.instances.keys()).map(id => 
            this.cleanupInstance(id).catch(error => {
              console.error(`Failed to stop browser ${id}:`, error);
            })
          )
        ),
        timeoutPromise
      ]);
    } catch (error) {
      console.error('Failed to stop all browsers:', error);
    } finally {
      // 确保清理所有资源
      this.instances.clear();
      this.isShuttingDown = false;
    }
  }

  getBrowserStatus(id: string): BrowserStatus | null {
    return this.instances.get(id)?.status || null;
  }

  getAllBrowserStatuses(): Map<string, BrowserStatus> {
    return new Map(
      Array.from(this.instances.entries()).map(([id, instance]) => [id, instance.status])
    );
  }

  private testHotReload() {
    console.log('Hot reload test function called at1:', new Date().toISOString());
  }
}

export const browserManager = new BrowserManager();

// Event handlers
process.on('exit', () => browserManager.stopAllBrowsers());
process.on('SIGINT', () => browserManager.stopAllBrowsers().then(() => process.exit(0)));
process.on('SIGTERM', () => browserManager.stopAllBrowsers().then(() => process.exit(0))); 