import { SearchOutlined } from '@ant-design/icons';
import { AutoComplete, Input, theme } from 'antd';
import type { InputRef } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { searchPeopleRequest } from '../../services/endpoints/people.endpoints';
import type { PersonSearchResult } from '../../types/people';
import { PersonAvatar } from '../PersonAvatar/PersonAvatar';
import { PersonProfileDrawer } from './PersonProfileDrawer';
import { PresenceTag } from './PresenceTag';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The header's employee search (Ctrl/⌘ + K). Choosing someone opens their profile. */
export function PeopleSearch() {
  const { token } = theme.useToken();
  const inputRef = useRef<InputRef>(null);
  const [text, setText] = useState('');
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useDebouncedValue(text.trim(), 250);

  // Ctrl/⌘ + K from anywhere jumps to the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    let current = true;
    setSearching(true);
    searchPeopleRequest(query)
      .then(({ data }) => current && setResults(data))
      .catch(() => current && setResults([]))
      .finally(() => current && setSearching(false));
    return () => {
      current = false;
    };
  }, [query]);

  const options = results.map((p) => ({
    value: p.id,
    label: (
      <div className="flex items-center gap-3 py-1" data-testid="search-result">
        <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} size="small" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{p.name}</div>
          <div className="truncate text-xs" style={{ color: token.colorTextSecondary }}>
            {[p.jobTitle, p.departmentName].filter(Boolean).join(' · ') || p.email}
          </div>
        </div>
        <PresenceTag presence={p.presence} wfh={p.wfh} />
      </div>
    ),
  }));

  return (
    <div className="header-search">
      <AutoComplete
        className="w-full"
        value={text}
        options={options}
        onSearch={setText}
        onSelect={(id: string) => {
          setOpenId(id);
          setText('');
          setResults([]);
          inputRef.current?.blur();
        }}
        notFoundContent={query && !searching ? <div className="py-2 text-sm">No one matches “{query}”</div> : null}
        popupMatchSelectWidth={380}
      >
        <Input
          ref={inputRef}
          allowClear
          aria-label="Search employees"
          prefix={<SearchOutlined />}
          suffix={
            <kbd className="header-kbd" aria-hidden>
              {isMac ? '⌘' : 'Ctrl'} + K
            </kbd>
          }
          placeholder="Search employees by name, title or department"
        />
      </AutoComplete>
      <PersonProfileDrawer personId={openId} onClose={() => setOpenId(null)} onOpenPerson={setOpenId} />
    </div>
  );
}
