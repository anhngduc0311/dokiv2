import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: ['/', '/api/catalog/image-proxy'],
    disallow: ['/api/', '/admin', '/dang-nhap', '/dang-ky', '/doi-mat-khau', '/theo-doi', '/lich-su'] },
    sitemap: absoluteUrl('/sitemap_index.xml'),
  };
}
