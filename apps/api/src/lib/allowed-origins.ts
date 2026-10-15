/**
 * The browser origins the API and its socket accept: the web app
 * (`WEB_URL`), production, and local development servers. One list, so HTTP
 * and the socket cannot disagree.
 */
const PRODUCTION_ORIGINS = ['https://nilo.so'];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
  'exp://localhost:8081',
  'http://10.0.2.2:8081',
];

export function allowedOrigins(): string[] {
  return [
    ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
    ...PRODUCTION_ORIGINS,
    ...DEV_ORIGINS,
  ];
}
