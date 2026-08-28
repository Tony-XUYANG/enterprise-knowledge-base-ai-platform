export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface ClientDevice {
  deviceName: string;
  deviceType: DeviceType;
}

export function describeClientDevice(userAgent: string | null): ClientDevice {
  if (!userAgent) {
    return { deviceName: '未知设备', deviceType: 'unknown' };
  }

  const browser = /Edg\//u.test(userAgent)
    ? 'Microsoft Edge'
    : /(?:Chrome|CriOS)\//u.test(userAgent)
      ? 'Google Chrome'
      : /(?:Firefox|FxiOS)\//u.test(userAgent)
        ? 'Firefox'
        : /Safari\//u.test(userAgent) && /Version\//u.test(userAgent)
          ? 'Safari'
          : /curl\//iu.test(userAgent)
            ? '命令行客户端'
            : '其他客户端';
  const operatingSystem = /Windows NT/u.test(userAgent)
    ? 'Windows'
    : /Android/u.test(userAgent)
      ? 'Android'
      : /(?:iPhone|iPad|iPod)/u.test(userAgent)
        ? 'iOS'
        : /Mac OS X/u.test(userAgent)
          ? 'macOS'
          : /Linux/u.test(userAgent)
            ? 'Linux'
            : '';
  const deviceType: DeviceType = /iPad|Tablet/u.test(userAgent)
    ? 'tablet'
    : /Mobile|iPhone|iPod|Android/u.test(userAgent)
      ? 'mobile'
      : browser === '其他客户端'
        ? 'unknown'
        : 'desktop';

  return {
    deviceName: operatingSystem ? `${browser} · ${operatingSystem}` : browser,
    deviceType,
  };
}
