import { useEffect, useState } from 'react';
import {
  isServerReachable,
  subscribeServerReachability,
} from '@/lib/serverReachability';

export function useOnlineStatus(): {
  browserOnline: boolean;
  serverReachable: boolean;
  available: boolean;
} {
  const [browserOnline, setBrowserOnline] = useState(
    () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  );
  const [serverReachable, setServerReachable] = useState(isServerReachable);

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => subscribeServerReachability(setServerReachable), []);

  return {
    browserOnline,
    serverReachable,
    available: browserOnline && serverReachable,
  };
}
