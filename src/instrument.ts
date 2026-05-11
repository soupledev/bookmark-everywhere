import type { ErrorInfo } from "react";
import type { RootOptions } from "react-dom/client";
import {
  BrowserClient,
  Scope,
  defaultStackParser,
  getDefaultIntegrations,
  makeFetchTransport,
} from "@sentry/react";

const integrations = getDefaultIntegrations({}).filter(
  (integration) =>
    !["BrowserApiErrors", "Breadcrumbs", "GlobalHandlers"].includes(
      integration.name,
    ),
);

const client = new BrowserClient({
  dsn: "https://4178b20e6341a8d3265fe93d3d7831c3@o4511342694432768.ingest.de.sentry.io/4511342696464464",
  environment: import.meta.env.MODE,
  integrations,
  stackParser: defaultStackParser,
  transport: makeFetchTransport,
  sendDefaultPii: false,
});

const scope = new Scope();
scope.setClient(client);
client.init();

export const reactRootOptions: RootOptions = {
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
  onUncaughtError: reactErrorHandler(),
};

function reactErrorHandler(
  callback?: (error: unknown, errorInfo: ErrorInfo, eventId: string) => void,
) {
  return (error: unknown, errorInfo: ErrorInfo) => {
    const captureScope = scope.clone();
    captureScope.setContext("react", {
      componentStack: errorInfo.componentStack,
    });
    const eventId = captureScope.captureException(error, {
      mechanism: {
        handled: Boolean(callback),
        type: "auto.function.react.error_handler",
      },
    });

    callback?.(error, errorInfo, eventId);
  };
}
