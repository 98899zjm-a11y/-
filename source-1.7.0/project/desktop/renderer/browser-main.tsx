import { installBrowserBridge } from './browser-bridge';

installBrowserBridge();
// Install the HTTP bridge before the shared app starts its session request.
void import('./main');
