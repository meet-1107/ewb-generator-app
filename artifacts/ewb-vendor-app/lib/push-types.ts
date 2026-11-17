/** Where a notification opens: the wallet, or one e-way bill. */
export type PushData = { route: 'wallet' | 'ewb' | 'support'; targetId?: string; noticeId?: string };

export type PushClient = {
  /** Asks for permission and sends this phone's token to the server. False when the user said no. */
  register(): Promise<boolean>;
  onTokenRefresh(): () => void;
  /** Sign-out: this phone stops getting the account's notifications. */
  unregister(): Promise<void>;
  /** A notification arrived while the app is open (the system does not show it then). */
  onForeground(listener: (title: string, body: string, data: PushData | null) => void): () => void;
  /** The user tapped a notification (also the one that opened the app). */
  onOpen(listener: (data: PushData) => void): () => void;
};
