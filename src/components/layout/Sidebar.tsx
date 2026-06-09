import { Inbox, Menu, Mic, Settings, ShieldAlert } from 'lucide-react';

export type PageKey = 'inbox' | 'calls' | 'issues' | 'settings';

const items = [
  ['inbox', 'Inbox', Inbox],
  ['calls', 'Calls', Mic],
  ['issues', 'Issues', ShieldAlert],
  ['settings', 'Settings', Settings]
] as const;

export function Sidebar({
  page,
  setPage,
  collapsed,
  setCollapsed
}: {
  page: PageKey;
  setPage: (p: PageKey) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}) {
  return (
    <aside className={'sidebar ' + (collapsed ? 'collapsed' : '')}>
      <button className="nav-toggle" onClick={() => setCollapsed(!collapsed)}>
        <Menu size={18} />
        {!collapsed && <span>Pflegemittelbox</span>}
      </button>
      <nav>
        {items.map(([key, label, Icon]) => (
          <button
            key={key}
            className={page === key ? 'active' : ''}
            onClick={() => setPage(key as PageKey)}
            title={label}
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>
      <div className="side-foot">{!collapsed && 'Marie QA cockpit'}</div>
    </aside>
  );
}
