import { useEffect, useState } from 'react';
import { Inbox as InboxIcon, MessageCircle } from 'lucide-react';
import SocialInbox from './SocialInbox';
import WhatsAppInbox from './WhatsAppInbox';
import '../whatsapp-inbox.css';

/**
 * The "My Customers" page now holds two inboxes: the existing social inbox
 * (Repliz) and the shop's WhatsApp chats. A small switch sits between them so
 * nothing about the social inbox itself had to change.
 */

type Props = {
  storeId: number;
  storeName: string;
  /** This page is on screen right now. */
  visible: boolean;
  refreshSignal: number;
  onActivity?: () => void;
  onChatOpenChange?: (open: boolean) => void;
};

type Tab = 'social' | 'whatsapp';

function readTab(storeId: number): Tab {
  try {
    return sessionStorage.getItem(`stoyangu-inbox-tab-${storeId}`) === 'whatsapp' ? 'whatsapp' : 'social';
  } catch {
    return 'social';
  }
}

export default function InboxTabs({ storeId, storeName, visible, refreshSignal, onActivity, onChatOpenChange }: Props) {
  const [tab, setTab] = useState<Tab>(() => readTab(storeId));

  useEffect(() => {
    try { sessionStorage.setItem(`stoyangu-inbox-tab-${storeId}`, tab); } catch { /* private mode: the choice simply does not persist */ }
  }, [storeId, tab]);

  const showingSocial = tab === 'social';

  return <>
    <div className="wap-tabs" role="tablist" aria-label="Inbox">
      <button
        type="button"
        role="tab"
        aria-selected={showingSocial}
        className={`wap-tab ${showingSocial ? 'active' : ''}`}
        onClick={() => setTab('social')}
      ><InboxIcon size={15} /> Social</button>
      <button
        type="button"
        role="tab"
        aria-selected={!showingSocial}
        className={`wap-tab ${!showingSocial ? 'active' : ''}`}
        onClick={() => setTab('whatsapp')}
      ><MessageCircle size={15} /> WhatsApp</button>
    </div>

    <div hidden={!showingSocial}>
      <SocialInbox
        key={storeId}
        storeId={storeId}
        storeName={storeName}
        active={true}
        visible={visible && showingSocial}
        refreshSignal={refreshSignal}
        onActivity={onActivity}
        onChatOpenChange={onChatOpenChange}
      />
    </div>

    <div hidden={showingSocial}>
      <WhatsAppInbox key={storeId} storeId={storeId} visible={visible && !showingSocial} refreshSignal={refreshSignal} />
    </div>
  </>;
}