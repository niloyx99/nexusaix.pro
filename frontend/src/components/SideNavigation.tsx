import React from 'react';

import { Home, Compass, BarChart2, User } from 'lucide-react';

import { motion } from 'motion/react';

import { TabType } from '../types';

import NexusLogoAvatar from './NexusLogoAvatar';



interface SideNavigationProps {

  activeTab: TabType;

  onChangeTab: (tab: TabType) => void;

}



const NAV: { id: TabType; label: string; icon: typeof Home }[] = [

  { id: 'home', label: 'Home', icon: Home },

  { id: 'signals', label: 'Signals', icon: Compass },

  { id: 'stats', label: 'Stats', icon: BarChart2 },

  { id: 'profile', label: 'Profile', icon: User },

];



export default function SideNavigation({ activeTab, onChangeTab }: SideNavigationProps) {

  return (

    <aside className="hidden lg:flex flex-col w-72 xl:w-80 shrink-0 h-full border-r border-white/[0.06] bg-black/20 backdrop-blur-2xl">

      <div className="px-5 pt-6 pb-5 border-b border-white/[0.06]">

        <div className="flex items-center gap-3">

          <NexusLogoAvatar size="md" />

          <div className="min-w-0">

            <span className="text-[14px] font-black tracking-[0.14em] text-white block leading-tight">

              NEXUS AI

            </span>

            <span className="text-[10px] text-white/40 font-semibold tracking-wide">

              Trading Analyzer

            </span>

          </div>

        </div>

      </div>



      <nav className="flex-1 px-4 py-6 space-y-1.5">

        {NAV.map((item) => {

          const Icon = item.icon;

          const isActive = activeTab === item.id;

          return (

            <button

              key={item.id}

              type="button"

              onClick={() => onChangeTab(item.id)}

              className={`relative w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-200 ${

                isActive

                  ? 'text-white'

                  : 'text-white/45 hover:text-white/75 hover:bg-white/[0.04]'

              }`}

            >

              {isActive && (

                <motion.div

                  layoutId="desktopNavIndicator"

                  className="absolute inset-0 rounded-xl bg-white/[0.06] border border-white/[0.1] shadow-[0_0_20px_rgba(255,255,255,0.04)]"

                  transition={{ type: 'spring', stiffness: 350, damping: 28 }}

                />

              )}

              <Icon className={`w-5 h-5 relative z-10 ${isActive ? 'text-amber-400' : ''}`} />

              <span className="text-[13px] font-bold relative z-10">{item.label}</span>

            </button>

          );

        })}

      </nav>



      <div className="px-4 pb-8 pt-4 border-t border-white/[0.06]">

        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">

          <NexusLogoAvatar size="sm" />

          <div className="min-w-0">

            <span className="text-[13px] font-bold text-white block truncate">Hello Everyone</span>

            <span className="text-[10px] text-emerald-400/80 font-semibold">Active License</span>

          </div>

        </div>

      </div>

    </aside>

  );

}


