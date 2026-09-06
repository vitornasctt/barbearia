export function diretivasCsp(config) {
  const prod = config.NODE_ENV === 'production';
  const d = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:',
      'https://*.tile.openstreetmap.org',
      'https://maps.gstatic.com', 'https://maps.googleapis.com', 'https://*.ggpht.com'],
    'frame-src': ['https://www.google.com', 'https://www.openstreetmap.org'],
    'connect-src': ["'self'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
  };
  if (prod) d['upgrade-insecure-requests'] = [];
  return d;
}
