'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../lib/i18n';
import { iconMap, IconGlobe, IconLogout } from './Icons';
import InstallAppButton from './InstallAppButton';
import { composeNavigation, FrontendDistribution, isCoreNavigationHref, NavigationItem, NavigationRegistration, pluginNavigation } from '../lib/navigation-registry';

/** Renders an icon: if `key` maps to an SVG component, uses it; otherwise falls back to text/emoji. */
function NavIcon({ icon, size = 20, className }: { icon: string; size?: number; className?: string }) {
  const Comp = iconMap[icon];
  if (Comp) return <Comp size={size} className={className} />;
  return <span className={`leading-none ${className || ''}`} style={{ fontSize: size }}>{icon}</span>;
}

type NavItem = NavigationItem;

interface SidebarProps {
  title: string;
  subtitle?: string;
  navItems: NavItem[];
  accentColor?: string;
  /** Which nav hrefs to show in the mobile bottom tab bar (max 5). Defaults to first 4 + settings/more. */
  bottomTabs?: string[];
}

const colorMap: Record<string, { bg: string; text: string; hover: string; active: string; ring: string; gradient: string }> = {
  indigo: {
    bg: 'bg-indigo-600',
    text: 'text-indigo-100',
    hover: 'hover:bg-white/10',
    active: 'bg-white/18 text-white font-semibold',
    ring: 'ring-indigo-500',
    gradient: 'from-[#1e1b4b] to-[#312e81]',
  },
  emerald: {
    bg: 'bg-emerald-600',
    text: 'text-emerald-100',
    hover: 'hover:bg-white/10',
    active: 'bg-white/18 text-white font-semibold',
    ring: 'ring-emerald-500',
    gradient: 'from-[#064e3b] to-[#065f46]',
  },
  sky: {
    bg: 'bg-sky-600',
    text: 'text-sky-100',
    hover: 'hover:bg-white/10',
    active: 'bg-white/18 text-white font-semibold',
    ring: 'ring-sky-500',
    gradient: 'from-[#0c4a6e] to-[#075985]',
  },
};

function pickBottomTabs(navItems: NavItem[], bottomTabs?: string[]): NavItem[] {
  if (bottomTabs) {
    return bottomTabs.map(href => navItems.find(n => n.href === href)).filter(Boolean) as NavItem[];
  }

  // UX-specific fixed tab order where camera stays centered.
  const hasAdminRoot = navItems.some(n => n.href === '/admin');
  const hasTeacherRoot = navItems.some(n => n.href === '/teacher');
  const hasStudentRoot = navItems.some(n => n.href === '/student');
  const hasParentRoot = navItems.some(n => n.href === '/parent');

  if (hasTeacherRoot) {
    const teacherOrder = ['/teacher', '/teacher/classes', '/teacher/camera', '/teacher/messages'];
    const teacherTabs = teacherOrder.map(href => navItems.find(n => n.href === href)).filter(Boolean) as NavItem[];
    if (teacherTabs.length === 4) {
      return [...teacherTabs, { label: 'common.more', href: '__more__', icon: 'settings' }];
    }
  }

  if (hasStudentRoot) {
    const studentOrder = ['/student', '/student/assignments', '/student/scores', '/student/messages'];
    const studentTabs = studentOrder.map(href => navItems.find(n => n.href === href)).filter(Boolean) as NavItem[];
    if (studentTabs.length === 4) {
      return [...studentTabs, { label: 'common.more', href: '__more__', icon: 'settings' }];
    }
  }

  if (hasParentRoot) {
    const parentOrder = ['/parent', '/parent/attendance', '/parent/grades', '/parent/messages'];
    const parentTabs = parentOrder.map(href => navItems.find(n => n.href === href)).filter(Boolean) as NavItem[];
    if (parentTabs.length === 4) {
      return [...parentTabs, { label: 'common.more', href: '__more__', icon: 'settings' }];
    }
  }

  if (hasAdminRoot) {
    const adminOrder = ['/admin', '/admin/manage-hub', '/admin/camera', '/admin/reports'];
    const adminTabs = adminOrder.map(href => navItems.find(n => n.href === href)).filter(Boolean) as NavItem[];
    if (adminTabs.length === 4) {
      return [...adminTabs, { label: 'common.more', href: '__more__', icon: 'settings' }];
    }
  }

  // Auto-pick: first item (dashboard) + up to 3 most important + last (settings)
  if (navItems.length <= 5) return navItems;
  const picked = [navItems[0]];
  // Find scan/attendance, reports, classes/users
  const priorities = ['camera', 'manage-hub', 'scan', 'reports', 'classes', 'users', 'search', 'attendance'];
  for (const p of priorities) {
    if (picked.length >= 4) break;
    const match = navItems.find(n => n.href.includes(p) && !picked.includes(n));
    if (match) picked.push(match);
  }
  // Fill remaining slots
  for (const n of navItems.slice(1)) {
    if (picked.length >= 4) break;
    if (!picked.includes(n)) picked.push(n);
  }
  // Add a "More" entry
  picked.push({ label: 'common.more', href: '__more__', icon: 'settings' });
  return picked;
}

export default function Sidebar({ title, subtitle, navItems, accentColor = 'indigo', bottomTabs }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const colors = colorMap[accentColor] || colorMap.indigo;
  const { lang, setLang, t } = useLanguage();
  const navRef = useRef<HTMLElement>(null);

  // Scroll the active nav item into view whenever the page changes
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const activeEl = nav.querySelector<HTMLElement>('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [pathname]);

  // Unread counts for badge-bearing nav items. Lightweight, polls every 30s.
  const needMessages = navItems.some(n => n.badgeKey === 'messages');
  const needAnnouncements = navItems.some(n => n.badgeKey === 'announcements');
  const needClassRegistrations = navItems.some(n => n.badgeKey === 'class-registrations');
  const needPlatformBilling = navItems.some(n => n.badgeKey === 'platform-billing');
  const [unread, setUnread] = useState<{ messages: number; announcements: number; 'class-registrations': number; 'platform-billing': number }>({ messages: 0, announcements: 0, 'class-registrations': 0, 'platform-billing': 0 });
  useEffect(() => {
    let active = true;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const tick = async () => {
      try {
        const reqs: Promise<Response>[] = [];
        if (needMessages) reqs.push(fetch(`${apiBase}/api/messages/unread-count`, { credentials: 'include' }));
        if (needAnnouncements) reqs.push(fetch(`${apiBase}/api/announcements/unread-count`, { credentials: 'include' }));
        if (needClassRegistrations) reqs.push(fetch(`${apiBase}/api/class-registrations/unread-count`, { credentials: 'include' }));
        // Deliberately not /api/platform-billing/... -- this count lives with the billing control
        // surface, which is the one path the suspension guard keeps open while a school is locked
        // out. A badge that vanished exactly when the bill went unpaid would be the wrong badge.
        if (needPlatformBilling) reqs.push(fetch(`${apiBase}/api/admin/marketplace/billing-control/unread-count`, { credentials: 'include' }));
        const results = await Promise.all(reqs);
        let i = 0;
        let next = { ...unread };
        if (needMessages) {
          const r = results[i++]; if (r.ok) next.messages = (await r.json()).count ?? 0;
        }
        if (needAnnouncements) {
          const r = results[i++]; if (r.ok) next.announcements = (await r.json()).count ?? 0;
        }
        if (needClassRegistrations) {
          const r = results[i++]; if (r.ok) next['class-registrations'] = (await r.json()).count ?? 0;
        }
        if (needPlatformBilling) {
          const r = results[i++]; if (r.ok) next['platform-billing'] = (await r.json()).count ?? 0;
        }
        if (active) setUnread(next);
      } catch { /* silent */ }
    };
    if (needMessages || needAnnouncements || needClassRegistrations || needPlatformBilling) {
      tick();
      const id = setInterval(tick, 30_000);
      return () => { active = false; clearInterval(id); };
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needMessages, needAnnouncements, needClassRegistrations, needPlatformBilling]);

  // Plugin nav: fetched once per session, filtered server-side to what this
  // user's role is actually granted (PluginExtensionsService.listForPrincipal).
  // Any role can have plugin nav now, not just admins -- merged into the
  // scrollable nav list and "More" drawer only, never into the curated
  // bottom-tab picks.
  const [pluginNav, setPluginNav] = useState<NavigationRegistration[]>([]);
  // Fail closed while runtime distribution is loading. NEXT_PUBLIC_* values are compiled into the
  // browser bundle and therefore cannot safely distinguish core and legacy schools that reuse the
  // same immutable web image; /api/version is the runtime authority.
  const [runtimeDistribution, setRuntimeDistribution] = useState<FrontendDistribution>('core');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
        const versionResponse = await fetch(`${apiBase}/api/version`, { credentials: 'include' });
        if (versionResponse.ok) {
          const version = await versionResponse.json();
          if (active && version?.distribution === 'legacy-full') setRuntimeDistribution('legacy-full');
        }
        const res = await fetch(`${apiBase}/api/plugin-api/my-extensions`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const entries = Array.isArray(data?.navigation) ? data.navigation : [];
        if (!active) return;
        setPluginNav(pluginNavigation(entries));
      } catch { /* plugin nav is optional; a fetch failure just means none shown */ }
    })();
    return () => { active = false; };
  }, []);
  const effectiveNavItems = composeNavigation(
    navItems.map((item) => ({
      ...item,
      source: isCoreNavigationHref(item.href) ? 'core' as const : 'legacy-business' as const,
    })),
    runtimeDistribution,
    pluginNav,
  );
  // All navigation surfaces must consume the same composed registry. Calculating tabs from the
  // static prop hid plugin entries on mobile even though the desktop sidebar displayed them.
  const tabs = pickBottomTabs(effectiveNavItems, bottomTabs);
  const hasMore = tabs.some(t => t.href === '__more__');

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    localStorage.removeItem('role');
    router.push('/login');
  };

  return (
    <>
      {/* ── Mobile: Top greeting bar ── */}
      <div className="lg:hidden print:hidden mobile-topbar-wrap">
        <div className="mobile-topbar" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div>
            <h1 className="font-bold text-lg leading-tight" style={{ color: 'var(--color-text)' }}>{title}</h1>
            {subtitle && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
          <InstallAppButton variant="compact" />
          <button
            onClick={() => setLang(lang === 'en' ? 'kh' : 'en')}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm ring-1 ring-white/70"
            style={{ color: 'var(--color-icon)' }}
            aria-label="Language"
          >
            <IconGlobe size={20} />
          </button>
          <button
            onClick={handleLogout}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm ring-1 ring-white/70"
            style={{ color: 'var(--color-icon)' }}
            aria-label="Logout"
          >
            <IconLogout size={20} />
          </button>
          </div>
        </div>
      </div>

      {/* ── Mobile: Bottom tab bar (matches mobile app) ── */}
      <div className="lg:hidden print:hidden mobile-bottomnav-wrap" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <nav className="mobile-bottomnav">
          {tabs.map((tab, idx) => {
            if (tab.href === '__more__') {
              return (
                <button
                  key="more"
                  onClick={() => { setShowMore(true); setCollapsed(true); }}
                  className="mobile-tab-btn"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <NavIcon icon={tab.icon} size={22} />
                </button>
              );
            }
            const isActive = pathname === tab.href;
            const isCameraCenter = tabs.length === 5 && idx === 2;
            const badgeCount = tab.badgeKey ? unread[tab.badgeKey] : 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`mobile-tab-btn ${isCameraCenter ? 'mobile-tab-camera' : ''}`}
                style={{ color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
              >
                <span className="relative inline-flex">
                  <NavIcon icon={tab.icon} size={22} />
                  {badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}
                </span>
                {isActive && <span className="mobile-tab-indicator" style={{ background: 'var(--color-primary)' }} />}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Mobile: Full-screen "More" drawer ── */}
      {collapsed && showMore && (
        <>
          <div className="lg:hidden fixed inset-0 bg-black/40 z-50" onClick={() => { setCollapsed(false); setShowMore(false); }} />
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-input-border)' }}>
              <h2 className="font-bold text-lg" style={{ color: 'var(--color-text)' }}>{t('common.more') || 'More'}</h2>
              <button
                onClick={() => { setCollapsed(false); setShowMore(false); }}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'var(--color-input-bg)' }}
              >✕</button>
            </div>
            <nav className="px-3 py-3">
              {effectiveNavItems.filter(item => !tabs.some(t => t.href === item.href)).map((item) => {
                const isExact = pathname === item.href;
                const isParent = !isExact && item.href !== '/' && item.href.length > 1
                  && effectiveNavItems.some(n => n.href !== item.href && n.href.startsWith(item.href + '/'))
                  && pathname.startsWith(item.href + '/');
                const isActive = isExact || isParent;
                const isChild = item.nested || effectiveNavItems.some(n => n.href !== item.href && n.href.length > 1 && item.href.startsWith(n.href + '/'));
                return (
                  <div key={item.href}>
                    {item.section && (
                      <p className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest"
                        style={{ color: 'var(--color-text-secondary)', opacity: 0.6 }}>
                        {t(item.section)}
                      </p>
                    )}
                    <Link
                      href={item.href}
                      onClick={() => { setCollapsed(false); setShowMore(false); }}
                      className={`relative flex items-center gap-3 py-2.5 rounded-xl text-sm transition-all ${isChild ? 'ml-3 pl-5 pr-4' : 'px-4'}`}
                      style={{
                        background: isExact
                          ? 'var(--color-primary-light)'
                          : isParent
                            ? 'rgba(var(--color-primary-rgb, 79 70 229) / 0.08)'
                            : 'transparent',
                        color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text)',
                        fontWeight: isExact ? 600 : isParent ? 500 : 400,
                      }}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-1/2 rounded-r-full"
                          style={{ background: 'var(--color-primary)' }} />
                      )}
                      {isChild && <span className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />}
                      <NavIcon icon={item.icon} size={isChild ? 18 : 22} />
                      <span className={isChild ? 'text-[13px]' : ''}>{t(item.label)}</span>
                    </Link>
                  </div>
                );
              })}
            </nav>
            <div className="px-3 pb-4 space-y-0.5">
              <div className="px-1 pb-2">
                <InstallAppButton variant="row" />
              </div>
              <Link
                href="/"
                onClick={() => { setCollapsed(false); setShowMore(false); }}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <NavIcon icon="dashboard" size={22} />
                <span>{t('common.backToHome')}</span>
              </Link>
            </div>
          </div>
        </>
      )}

      {/* ── Mobile: Slide-in sidebar for hamburger (legacy, hidden if bottom nav is used) ── */}
      {collapsed && !showMore && (
        <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setCollapsed(false)} />
      )}

      {/* ── Desktop: Full sidebar ── */}
      <aside className={`
        hidden lg:flex lg:sticky top-0 left-0 z-50 lg:z-auto
        h-screen bg-gradient-to-b ${colors.gradient} text-white
        flex-col shadow-2xl transition-all duration-200 overflow-hidden
        ${sidebarOpen ? 'w-64' : 'w-14'}
      `}>
        {/* Logo area */}
        <div className="px-3 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 hover:bg-white/20 transition-all duration-150" style={{ background: 'rgba(255,255,255,0.13)' }}
            >
              {sidebarOpen
                ? <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M5 7l-3 3 3 3M3 10h14M15 7l3 3-3 3" /></svg>
                : <span>{title.charAt(0)}</span>}
            </button>
            {sidebarOpen && (
              <div className="min-w-0">
                <h1 className="font-bold text-sm leading-tight truncate">{title}</h1>
                {subtitle && <p className="text-[11px] text-white/50 mt-0.5 truncate">{subtitle}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav ref={navRef} className="flex-1 px-2 py-3 overflow-y-auto overscroll-contain scroll-smooth">
          {/* Back to Home */}
          <Link
            href="/"
            title={sidebarOpen ? undefined : t('common.backToHome')}
            className={`flex items-center gap-3 px-2.5 py-2 mb-1 rounded-xl text-sm ${colors.text} hover:bg-white/10 transition-colors ${sidebarOpen ? '' : 'justify-center'}`}
          >
            <svg viewBox="0 0 20 20" className="shrink-0" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4l-6 6 6 6" />
            </svg>
            {sidebarOpen && <span className="truncate text-white/70">{t('common.backToHome')}</span>}
          </Link>
          <div className={`border-t border-white/10 mb-2 ${sidebarOpen ? 'mx-1' : 'mx-0'}`} />
          {effectiveNavItems.map((item, idx) => {
            // ── Active state detection ──────────────────────────────────
            // isExact: user is on exactly this page
            const isExact = pathname === item.href;
            // isParent: this item is a parent and a child page is currently open
            const isParent = !isExact
              && item.href !== '/'
              && item.href.length > 1
              && effectiveNavItems.some(n => n.href !== item.href && n.href.startsWith(item.href + '/'))
              && pathname.startsWith(item.href + '/');
            const isActive = isExact || isParent;

            // isChild: this item lives under a parent that exists in navItems
            const parentHref = effectiveNavItems.find(
              n => n.href !== item.href && n.href.length > 1 && item.href.startsWith(n.href + '/')
            )?.href;
            const isChild = item.nested || !!parentHref;

            const badgeCount = item.badgeKey ? unread[item.badgeKey] : 0;

            return (
              <div key={item.href}>
                {sidebarOpen && item.section && (
                  <p className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40 ${idx === 0 ? 'pt-0' : 'pt-4'}`}>
                    {t(item.section)}
                  </p>
                )}
                <Link
                  href={item.href}
                  data-active={isActive ? 'true' : undefined}
                  title={sidebarOpen ? undefined : t(item.label)}
                  className={`relative flex items-center gap-3 rounded-xl text-sm transition-all duration-150
                    ${isChild && sidebarOpen ? 'ml-3 pl-5 pr-2.5 py-1.5' : 'px-2.5 py-2'}
                    ${isExact
                      ? 'bg-white/20 text-white font-semibold shadow-sm'
                      : isParent
                        ? 'bg-white/10 text-white font-medium'
                        : `${colors.text} ${colors.hover}`
                    }
                    ${sidebarOpen ? '' : 'justify-center'}
                  `}
                >
                  {/* Left accent bar for active items */}
                  {sidebarOpen && isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-white"
                      style={{ height: isExact ? '60%' : '40%', opacity: isExact ? 1 : 0.6 }} />
                  )}
                  {/* Tree connector line for child items */}
                  {isChild && sidebarOpen && (
                    <span className="absolute left-3 top-0 bottom-0 w-px bg-white/20" />
                  )}
                  <span className="relative inline-flex flex-none">
                    <NavIcon icon={item.icon} size={isChild ? 15 : 17} className={isActive ? 'opacity-100' : 'opacity-80'} />
                    {badgeCount > 0 && !sidebarOpen && (
                      <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                        {badgeCount > 9 ? '9+' : badgeCount}
                      </span>
                    )}
                  </span>
                  {sidebarOpen && (
                    <span className={`truncate flex-1 ${isChild ? 'text-[13px]' : ''}`}>{t(item.label)}</span>
                  )}
                  {sidebarOpen && badgeCount > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                  {/* Active dot for collapsed mode */}
                  {!sidebarOpen && isActive && (
                    <span className="absolute right-0.5 top-0.5 w-2 h-2 rounded-full bg-white" />
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Bottom — compact, icon-only regardless of expand state */}
        <div className={`px-2 py-2 border-t border-white/10 flex items-center gap-0.5 ${sidebarOpen ? 'justify-center' : 'flex-col'}`}>
          <InstallAppButton variant="icon" className={`${colors.text} hover:bg-white/10`} />
          <button
            onClick={() => setLang(lang === 'en' ? 'kh' : 'en')}
            title={lang === 'en' ? 'ភាសាខ្មែរ' : 'English'}
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${colors.text} hover:bg-white/10 transition-colors`}
          >
            <IconGlobe size={16} />
          </button>
          <Link
            href="/settings/notifications"
            title="Notification settings"
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${colors.text} hover:bg-white/10 transition-colors`}
          >
            <NavIcon icon="settings" size={16} />
          </Link>
          <button
            onClick={handleLogout}
            title={t('common.logout')}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-red-300/90 hover:bg-white/10 transition-colors"
          >
            <IconLogout size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
