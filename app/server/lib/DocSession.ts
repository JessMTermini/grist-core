import {BrowserSettings} from 'app/common/BrowserSettings';
import {Role} from 'app/common/roles';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Authorizer, getUserId, RequestWithLogin} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';

/**
 * OptDocSession allows for certain ActiveDoc operations to work with or without an open document.
 * It is useful in particular for actions when importing a file to create a new document.
 */
export interface OptDocSession {
  client: Client|null;
  shouldBundleActions?: boolean;
  linkId?: number;
  browserSettings?: BrowserSettings;
  req?: RequestWithLogin;
  mode?: 'nascent'|'plugin'|'system';   // special permissions for creating, plugins, and system access
  authorizer?: Authorizer;
}

export function makeOptDocSession(client: Client|null, browserSettings?: BrowserSettings): OptDocSession {
  if (client && !browserSettings) { browserSettings = client.browserSettings; }
  return {client, browserSettings};
}

/**
 * Create an OptDocSession with special access rights.
 *  - nascent: user is treated as owner (because doc is being created)
 *  - plugin: user is treated as editor (because plugin access control is crude)
 *  - system: user is treated as owner (because of some operation bypassing access control)
 */
export function makeExceptionalDocSession(mode: 'nascent'|'plugin'|'system',
                                          options: {client?: Client,
                                                    req?: RequestWithLogin,
                                                    browserSettings?: BrowserSettings} = {}): OptDocSession {
  const docSession = makeOptDocSession(options.client || null, options.browserSettings);
  docSession.mode = mode;
  docSession.req = options.req;
  return docSession;
}

/**
 * Create an OptDocSession from a request.  Request should have user and doc access
 * middleware.
 */
export function docSessionFromRequest(req: RequestWithLogin): OptDocSession {
  return {client: null, req};
}

/**
 * DocSession objects maintain information for a single session<->doc instance.
 */
export class DocSession implements OptDocSession {
  /**
   * Flag to indicate that user actions 'bundle' process is started and in progress (`true`),
   * otherwise it's `false`
   */
  public shouldBundleActions?: boolean;

  /**
   * Indicates the actionNum of the previously applied action
   * to which the first action in actions should be linked.
   * Linked actions appear as one action and can be undone/redone in a single step.
   */
  public linkId?: number;

  constructor(
    public readonly activeDoc: ActiveDoc,
    public readonly client: Client,
    public readonly fd: number,
    public readonly authorizer: Authorizer
  ) {}

  // Browser settings (like timezone) obtained from the Client.
  public get browserSettings(): BrowserSettings { return this.client.browserSettings; }
}

/**
 * Extract userId from OptDocSession.  Use Authorizer if available (for web socket
 * sessions), or get it from the Request if that is available (for rest api calls),
 * or from the Client if that is available.  Returns null if userId information is
 * not available or not cached.
 */
export function getDocSessionUserId(docSession: OptDocSession): number|null {
  if (docSession.authorizer) {
    return docSession.authorizer.getUserId();
  }
  if (docSession.req) {
    return getUserId(docSession.req);
  }
  if (docSession.client) {
    return docSession.client.getCachedUserId();
  }
  return null;
}

/**
 * Extract user's role from OptDocSession.  Method depends on whether using web
 * sockets or rest api.  Assumes that access has already been checked by wrappers
 * for api methods and that cached access information is therefore available.
 */
export function getDocSessionAccess(docSession: OptDocSession): Role {
  // "nascent" DocSessions are for when a document is being created, and user is
  // its only owner as yet.
  // "system" DocSessions are for access without access control.
  if (docSession.mode === 'nascent' || docSession.mode === 'system') { return 'owners'; }
  // "plugin" DocSessions are for access from plugins, which is currently quite crude,
  // and granted only to editors.
  if (docSession.mode === 'plugin') { return 'editors'; }
  if (docSession.authorizer) {
    const access = docSession.authorizer.getCachedAuth().access;
    if (!access) { throw new Error('getDocSessionAccess expected authorizer.getCachedAuth'); }
    return access;
  }
  if (docSession.req) {
    const access =  docSession.req.docAuth?.access;
    if (!access) { throw new Error('getDocSessionAccess expected req.docAuth.access'); }
    return access;
  }
  throw new Error('getDocSessionAccess could not find access information in DocSession');
}