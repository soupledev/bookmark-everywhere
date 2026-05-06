import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://4178b20e6341a8d3265fe93d3d7831c3@o4511342694432768.ingest.de.sentry.io/4511342696464464",
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  sendDefaultPii: false,
  tracesSampleRate: 0.2,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
