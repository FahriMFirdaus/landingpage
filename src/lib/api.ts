const DEFAULT_API_URL = 'https://api.gampangberes.biz.id/api';
let rawUrl = import.meta.env.PUBLIC_API_BASE_URL || DEFAULT_API_URL;
rawUrl = rawUrl.replace(/\/+$/, '');
if (!rawUrl.endsWith('/api')) {
  rawUrl = `${rawUrl}/api`;
}
export const API_BASE_URL = rawUrl;
export const BASE_URL = API_BASE_URL.replace(/\/api$/, '');

// Cache dengan TTL — data di browser akan selalu fresh dalam 60 detik.
// Ini memastikan perubahan dari dashboard admin langsung terlihat tanpa
// user harus hard-refresh halaman.
const CACHE_TTL_MS = 60 * 1000; // 60 detik

let appStatusPromise: Promise<any> | null = null;
let appStatusCachedAt: number = 0;

/** Force-refresh cache. Panggil jika butuh data terbaru segera. */
export function invalidateAppStatusCache() {
  appStatusPromise = null;
  appStatusCachedAt = 0;
}

export const formatCurrency = (value: number | string | undefined | null) => {
  if (value === undefined || value === null) return '';
  const num = typeof value === 'string' ? parseInt(value) : value;
  if (isNaN(num)) return value.toString();
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

export async function getAppStatus() {
  const isClient = typeof window !== 'undefined';
  const now = Date.now();

  // Di browser: pakai cache hanya jika belum kadaluarsa (< 60 detik)
  if (isClient && appStatusPromise && (now - appStatusCachedAt) < CACHE_TTL_MS) {
    return appStatusPromise;
  }

  const fetchPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/app-status`, {
        // Paksa browser & CDN selalu ambil data terbaru dari server.
        // Tanpa header ini, browser/proxy bisa meng-cache response dan
        // perubahan dari admin tidak akan kelihatan.
        headers: {
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Network response was not ok');
      const json = await response.json();
      const data = json.data;
      if (!data) return null;

      if (data.whatsapp_links && data.whatsapp_links.length > 0) {
        data.contact_whatsapp = data.whatsapp_links[0];
      } else if (data.contact_whatsapp && data.contact_whatsapp.includes(',')) {
        const firstNum = data.contact_whatsapp.split(',')[0].trim();
        data.contact_whatsapp = `https://wa.me/${firstNum}`;
      } else if (data.contact_whatsapp && !data.contact_whatsapp.startsWith('http')) {
        data.contact_whatsapp = `https://wa.me/${data.contact_whatsapp.trim()}`;
      }
      
      if (data.download_url && !data.download_url.startsWith('http')) {
        data.download_url = `${BASE_URL}${data.download_url.startsWith('/') ? '' : '/'}${data.download_url}`;
      }

      // ONLY FETCH FILE SIZE ON SERVER-SIDE IF NOT PROVIDED BY BACKEND
      // This bypasses CORS and prevents errors in the browser console.
      const isServer = typeof window === 'undefined';
      
      if (data.app_size && data.app_size > 0) {
        const totalBytes = data.app_size;
        const mb = totalBytes / (1024 * 1024);
        if (mb < 1) {
          const kb = Math.max(1, Math.round(totalBytes / 1024));
          data.file_size = `~${kb} KB`;
        } else {
          data.file_size = `~${Math.round(mb * 10) / 10} MB`;
        }
      } else if (isServer && data.download_url && data.download_url.startsWith('http') && !data.file_size) {
        try {
          const fetchOptions: RequestInit = { 
            method: 'GET',
            headers: {
              'Range': 'bytes=0-0'
            },
            redirect: 'follow',
          };
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          fetchOptions.signal = controller.signal;

          const fileRes = await fetch(data.download_url, fetchOptions);
          clearTimeout(timeoutId);
          
          const contentRange = fileRes.headers.get('content-range');
          const contentLength = fileRes.headers.get('content-length');
          
          let totalBytes = 0;
          if (contentRange) {
            const parts = contentRange.split('/');
            if (parts.length > 1) totalBytes = parseInt(parts[1]);
          } else if (contentLength) {
            totalBytes = parseInt(contentLength);
          }

          if (totalBytes > 1024 * 100) { 
            const mb = totalBytes / (1024 * 1024);
            if (mb < 1) {
              const kb = Math.max(1, Math.round(totalBytes / 1024));
              data.file_size = `~${kb} KB`;
            } else {
              data.file_size = `~${Math.round(mb)} MB`;
            }
          }
        } catch (e) {
          // Silently fail on server
        }
      }
      return data;
    } catch (error) {
      console.error('Error fetching app status:', error);
      // Saat error: hapus cache agar fetch berikutnya bisa mencoba ulang
      appStatusPromise = null;
      appStatusCachedAt = 0;
      return null;
    }
  })();

  if (isClient) {
    appStatusPromise = fetchPromise;
    appStatusCachedAt = now;
  }
  return fetchPromise;
}

export async function getWhatsAppContacts() {
  try {
    const data = await getAppStatus();
    let contacts: string[] = [];
    if (data && data.whatsapp_contacts && Array.isArray(data.whatsapp_contacts)) {
      contacts = data.whatsapp_contacts;
    } else if (data && data.contact_whatsapp) {
       contacts = [data.contact_whatsapp];
    }
    if (contacts.length === 0) return [];
    return contacts.map(num => ({
      number: num,
      link: num.startsWith('http') ? num : `https://wa.me/${num}`
    }));
  } catch (error) {
    return [];
  }
}

export async function getBanners() {
  try {
    const response = await fetch(`${API_BASE_URL}/banners`);
    if (!response.ok) return [];
    const json = await response.json();
    return json.success ? json.data : [];
  } catch (error) {
    return [];
  }
}

export async function getAnnouncements() {
  try {
    const response = await fetch(`${API_BASE_URL}/announcements`);
    if (!response.ok) return [];
    const json = await response.json();
    return json.success ? json.data : [];
  } catch (error) {
    return [];
  }
}

export async function getTerms() {
  try {
    const response = await fetch(`${API_BASE_URL}/legal/terms`);
    if (!response.ok) return null;
    const json = await response.json();
    return json.data;
  } catch (error) {
    return null;
  }
}

export async function getPrivacy() {
  try {
    const response = await fetch(`${API_BASE_URL}/legal/privacy`);
    if (!response.ok) return null;
    const json = await response.json();
    return json.data;
  } catch (error) {
    return null;
  }
}
