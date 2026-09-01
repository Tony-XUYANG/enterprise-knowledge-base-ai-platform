'use client';

import {
  BookOpenText,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessagesSquare,
  Settings,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type { User } from '@/lib/types';
import { Brand } from './brand';

interface WorkspaceShellProps {
  active: 'overview' | 'apps' | 'knowledge-bases' | 'conversations' | 'members' | 'settings';
  title: string;
  children: ReactNode;
}

const navigation = [
  { id: 'overview' as const, href: '/overview', label: '总览', icon: LayoutDashboard },
  { id: 'apps' as const, href: '/apps', label: 'AI 应用', icon: LayoutGrid },
  {
    id: 'knowledge-bases' as const,
    href: '/knowledge-bases',
    label: '知识库',
    icon: BookOpenText,
  },
  {
    id: 'conversations' as const,
    href: '/conversations',
    label: '对话记录',
    icon: MessagesSquare,
  },
  {
    id: 'members' as const,
    href: '/members',
    label: '成员管理',
    icon: UsersRound,
    adminOnly: true,
  },
  { id: 'settings' as const, href: '/settings', label: '账户设置', icon: Settings },
];

export function WorkspaceShell({ active, title, children }: WorkspaceShellProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let mounted = true;
    const handleUserUpdated = (event: Event) => {
      const updatedUser = (event as CustomEvent<User>).detail;
      if (updatedUser?.id) setUser(updatedUser);
    };
    window.addEventListener('knowledgehub:user-updated', handleUserUpdated);
    clientApi<User>('/api/auth/session')
      .then((currentUser) => {
        if (mounted) setUser(currentUser);
      })
      .catch((error: unknown) => {
        if (error instanceof ClientApiError && error.status === 401) {
          router.replace('/login');
          router.refresh();
          return;
        }
        if (mounted) setSessionError('会话加载失败');
      });
    return () => {
      mounted = false;
      window.removeEventListener('knowledgehub:user-updated', handleUserUpdated);
    };
  }, [router]);

  const userInitial = useMemo(
    () => user?.displayName.trim().slice(0, 1).toUpperCase() || 'U',
    [user],
  );
  const visibleNavigation = useMemo(
    () => navigation.filter((item) => !('adminOnly' in item) || user?.roles.includes('admin')),
    [user],
  );

  async function logout() {
    try {
      await clientApi<void>('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <Brand href="/overview" />
        <nav className="sidebarNav" aria-label="主导航">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <Link
                className={`navItem${isActive ? ' active' : ''}`}
                href={item.href}
                key={item.id}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebarUser">
          <span className="avatar" aria-hidden="true">{userInitial}</span>
          <span className="userMeta">
            <strong>{user?.displayName ?? '加载中'}</strong>
            <small>{sessionError || user?.email || ''}</small>
          </span>
          <button className="iconButton" type="button" onClick={logout} aria-label="退出登录" title="退出登录">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="mobileHeader">
          <Brand href="/overview" compact />
          <strong>{title}</strong>
          <span className="mobileHeaderActions">
            <Link className="iconButton" href="/settings" aria-label="账户设置" title="账户设置">
              <Settings size={18} />
            </Link>
            <button className="iconButton" type="button" onClick={logout} aria-label="退出登录" title="退出登录">
              <LogOut size={18} />
            </button>
          </span>
        </header>
        {children}
      </main>
    </div>
  );
}
