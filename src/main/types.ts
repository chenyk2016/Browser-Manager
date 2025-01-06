import { Browser } from 'puppeteer-core';

export interface BrowserStatus {
  isRunning: boolean;
  lastChecked: number;
  inProgress: boolean;
  action?: 'starting' | 'stopping';
}

export interface BrowserInstance {
  id: string;
  browser: Browser;
  config: BrowserConfig;
  status: BrowserStatus;
}

export interface BrowserConfig {
  id: string;
  name: string;
} 