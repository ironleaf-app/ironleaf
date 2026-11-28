// The left side's frame (8.7 wave 1; 30 Oct 2026; 10.0 Endless Tech: the brand row with the one main action under it; 5
// Nov 2026, one search door and a quiet rail, Home folded into Today; 8 Nov 2026, the quiet More; 9 Nov 2026, the rows
// back in a quiet second group): the space mark, the wordmark and the business name, New, the quiet rows (Today, Inbox,
// Projects, Tasks, Meetings, Notes, People, More), and the foot (the account chip with the bell; 20 Nov 2026) pinned at
// the bottom. Search left for the centred bar (Ctrl+O opens it too); Today is the one morning place (no Home row: old
// links to Home open Today); More keeps the eight a person reaches for on top, then a thin line and small group names
// hold the rest (Pages, Make and open, Find, Packs and kinds), folding biggest-first to never scroll at 709px high; the
// pins sit behind it, and everything still answers in Ctrl+K by its own name; counts sit on Today and Inbox only, through
// the one count. Folded, the same places as an icon rail (frame-collapsed.png). Nothing the person could reach is lost:
// every place opens from here, its More, or the palette (tests/frame-87.test.mjs guards each one).

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { closeMenu, openMenu, type MenuItem } from '../components/Menu';
import * as A from '../state/actions';
import { hideSide, setRail } from '../state/fit';
import { useWorkspace } from '../state/layout';
import { openModal, requestSearch } from '../state/modals';
import { setPerson } from '../state/person';
import { shows } from '../../../shared/prefs';
import { useApp, usePrefs } from '../state/store';
import { activeTab } from '../state/workspace';
import { currentProject, openTemplates } from '../state/templates';
import { useInboxCount } from './AreasPlaces';
import { NoticeBell } from './NoticeBell';
import { minPopupTop } from '../lib/windowButtons';
import { todayData } from '../lib/todayData';
import { moduleOn, modulesOn } from '../../../shared/life-modules';
import { moreFoldToFit, nextMoreFold } from '../../../shared/more-fit';
import { moduleOfTab, openModule, useModules } from '../state/modules';
import { getAreas } from '../state/areas';
import { openInbox, openLife, openMeetings, openPeople } from '../state/life';
import { openNewDoor, openTypePage, typeOfTab } from '../state/noteTypes';
import { useBookmarks } from '../state/bookmarks';
import { useShellTypes } from '../state/shellTypes';
import { AccountChip } from '../components/account/AccountMenu';
import { sidebarTodayCount } from '../../../shared/today';

/** Ironleaf's mark (20 Nov 2026, the rename): the leaf with its folded corner on the iron tile, as the app icon
 *  (resources/icon.png) and the brand kit (ironleaf-brand (the brand kit, kept outside this repository): mark-tile.svg, and mark-tile-small.svg below 32 px,
 *  where the thin stem would blur). tools/make-icon.py copies the icon from the same kit. */
function VaultMark({ size }: { size: number }) {
  return size < 32 ? (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true">
      <defs><linearGradient id="il-mark-s-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E343C"/><stop offset="1" stopColor="#1C2026"/></linearGradient><linearGradient id="il-mark-s-e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".16"/><stop offset=".5" stopColor="#FFFFFF" stopOpacity="0"/></linearGradient></defs><path d="M1011.71 512.00L1011.65 625.42L1011.47 661.64L1011.17 687.95L1010.75 709.35L1010.21 727.70L1009.54 743.91L1008.76 758.54L1007.85 771.90L1006.82 784.26L1005.67 795.76L1004.39 806.54L1002.99 816.68L1001.47 826.28L999.82 835.38L998.04 844.04L996.13 852.30L994.10 860.18L991.94 867.73L989.64 874.96L987.22 881.89L984.66 888.55L981.96 894.95L979.12 901.10L976.15 907.02L973.03 912.71L969.77 918.19L966.37 923.47L962.81 928.55L959.10 933.44L955.24 938.14L951.21 942.67L947.02 947.02L942.67 951.21L938.14 955.24L933.44 959.10L928.55 962.81L923.47 966.37L918.19 969.77L912.71 973.03L907.02 976.15L901.10 979.12L894.95 981.96L888.55 984.66L881.89 987.22L874.96 989.64L867.73 991.94L860.18 994.10L852.30 996.13L844.04 998.04L835.38 999.82L826.28 1001.47L816.68 1002.99L806.54 1004.39L795.76 1005.67L784.26 1006.82L771.90 1007.85L758.54 1008.76L743.91 1009.54L727.70 1010.21L709.35 1010.75L687.95 1011.17L661.64 1011.47L625.42 1011.65L512.00 1011.71L398.58 1011.65L362.36 1011.47L336.05 1011.17L314.65 1010.75L296.30 1010.21L280.09 1009.54L265.46 1008.76L252.10 1007.85L239.74 1006.82L228.24 1005.67L217.46 1004.39L207.32 1002.99L197.72 1001.47L188.62 999.82L179.96 998.04L171.70 996.13L163.82 994.10L156.27 991.94L149.04 989.64L142.11 987.22L135.45 984.66L129.05 981.96L122.90 979.12L116.98 976.15L111.29 973.03L105.81 969.77L100.53 966.37L95.45 962.81L90.56 959.10L85.86 955.24L81.33 951.21L76.98 947.02L72.79 942.67L68.76 938.14L64.90 933.44L61.19 928.55L57.63 923.47L54.23 918.19L50.97 912.71L47.85 907.02L44.88 901.10L42.04 894.95L39.34 888.55L36.78 881.89L34.36 874.96L32.06 867.73L29.90 860.18L27.87 852.30L25.96 844.04L24.18 835.38L22.53 826.28L21.01 816.68L19.61 806.54L18.33 795.76L17.18 784.26L16.15 771.90L15.24 758.54L14.46 743.91L13.79 727.70L13.25 709.35L12.83 687.95L12.53 661.64L12.35 625.42L12.29 512.00L12.35 398.58L12.53 362.36L12.83 336.05L13.25 314.65L13.79 296.30L14.46 280.09L15.24 265.46L16.15 252.10L17.18 239.74L18.33 228.24L19.61 217.46L21.01 207.32L22.53 197.72L24.18 188.62L25.96 179.96L27.87 171.70L29.90 163.82L32.06 156.27L34.36 149.04L36.78 142.11L39.34 135.45L42.04 129.05L44.88 122.90L47.85 116.98L50.97 111.29L54.23 105.81L57.63 100.53L61.19 95.45L64.90 90.56L68.76 85.86L72.79 81.33L76.98 76.98L81.33 72.79L85.86 68.76L90.56 64.90L95.45 61.19L100.53 57.63L105.81 54.23L111.29 50.97L116.98 47.85L122.90 44.88L129.05 42.04L135.45 39.34L142.11 36.78L149.04 34.36L156.27 32.06L163.82 29.90L171.70 27.87L179.96 25.96L188.62 24.18L197.72 22.53L207.32 21.01L217.46 19.61L228.24 18.33L239.74 17.18L252.10 16.15L265.46 15.24L280.09 14.46L296.30 13.79L314.65 13.25L336.05 12.83L362.36 12.53L398.58 12.35L512.00 12.29L625.42 12.35L661.64 12.53L687.95 12.83L709.35 13.25L727.70 13.79L743.91 14.46L758.54 15.24L771.90 16.15L784.26 17.18L795.76 18.33L806.54 19.61L816.68 21.01L826.28 22.53L835.38 24.18L844.04 25.96L852.30 27.87L860.18 29.90L867.73 32.06L874.96 34.36L881.89 36.78L888.55 39.34L894.95 42.04L901.10 44.88L907.02 47.85L912.71 50.97L918.19 54.23L923.47 57.63L928.55 61.19L933.44 64.90L938.14 68.76L942.67 72.79L947.02 76.98L951.21 81.33L955.24 85.86L959.10 90.56L962.81 95.45L966.37 100.53L969.77 105.81L973.03 111.29L976.15 116.98L979.12 122.90L981.96 129.05L984.66 135.45L987.22 142.11L989.64 149.04L991.94 156.27L994.10 163.82L996.13 171.70L998.04 179.96L999.82 188.62L1001.47 197.72L1002.99 207.32L1004.39 217.46L1005.67 228.24L1006.82 239.74L1007.85 252.10L1008.76 265.46L1009.54 280.09L1010.21 296.30L1010.75 314.65L1011.17 336.05L1011.47 362.36L1011.65 398.58Z" fill="url(#il-mark-s-g)"/><path fill="#F5F2EA" d="M279.99 692.72L180.54 792.17L231.83 843.46L331.28 744.01Z"/><path fill="#F5F2EA" d="M268.10 755.90C289.69 509.16 169.98 267.31 430.73 217.98L570.16 191.60L508.97 515.03L832.40 453.84L806.02 593.27C756.69 854.02 514.84 734.31 268.10 755.90Z"/><path fill="#7CC197" d="M641.12 178.18L845.82 382.88L593.36 430.64Z"/>
    </svg>
  ) : (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true">
      <defs><linearGradient id="il-mark-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E343C"/><stop offset="1" stopColor="#1C2026"/></linearGradient><linearGradient id="il-mark-e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".16"/><stop offset=".5" stopColor="#FFFFFF" stopOpacity="0"/></linearGradient></defs><path d="M1011.71 512.00L1011.65 625.42L1011.47 661.64L1011.17 687.95L1010.75 709.35L1010.21 727.70L1009.54 743.91L1008.76 758.54L1007.85 771.90L1006.82 784.26L1005.67 795.76L1004.39 806.54L1002.99 816.68L1001.47 826.28L999.82 835.38L998.04 844.04L996.13 852.30L994.10 860.18L991.94 867.73L989.64 874.96L987.22 881.89L984.66 888.55L981.96 894.95L979.12 901.10L976.15 907.02L973.03 912.71L969.77 918.19L966.37 923.47L962.81 928.55L959.10 933.44L955.24 938.14L951.21 942.67L947.02 947.02L942.67 951.21L938.14 955.24L933.44 959.10L928.55 962.81L923.47 966.37L918.19 969.77L912.71 973.03L907.02 976.15L901.10 979.12L894.95 981.96L888.55 984.66L881.89 987.22L874.96 989.64L867.73 991.94L860.18 994.10L852.30 996.13L844.04 998.04L835.38 999.82L826.28 1001.47L816.68 1002.99L806.54 1004.39L795.76 1005.67L784.26 1006.82L771.90 1007.85L758.54 1008.76L743.91 1009.54L727.70 1010.21L709.35 1010.75L687.95 1011.17L661.64 1011.47L625.42 1011.65L512.00 1011.71L398.58 1011.65L362.36 1011.47L336.05 1011.17L314.65 1010.75L296.30 1010.21L280.09 1009.54L265.46 1008.76L252.10 1007.85L239.74 1006.82L228.24 1005.67L217.46 1004.39L207.32 1002.99L197.72 1001.47L188.62 999.82L179.96 998.04L171.70 996.13L163.82 994.10L156.27 991.94L149.04 989.64L142.11 987.22L135.45 984.66L129.05 981.96L122.90 979.12L116.98 976.15L111.29 973.03L105.81 969.77L100.53 966.37L95.45 962.81L90.56 959.10L85.86 955.24L81.33 951.21L76.98 947.02L72.79 942.67L68.76 938.14L64.90 933.44L61.19 928.55L57.63 923.47L54.23 918.19L50.97 912.71L47.85 907.02L44.88 901.10L42.04 894.95L39.34 888.55L36.78 881.89L34.36 874.96L32.06 867.73L29.90 860.18L27.87 852.30L25.96 844.04L24.18 835.38L22.53 826.28L21.01 816.68L19.61 806.54L18.33 795.76L17.18 784.26L16.15 771.90L15.24 758.54L14.46 743.91L13.79 727.70L13.25 709.35L12.83 687.95L12.53 661.64L12.35 625.42L12.29 512.00L12.35 398.58L12.53 362.36L12.83 336.05L13.25 314.65L13.79 296.30L14.46 280.09L15.24 265.46L16.15 252.10L17.18 239.74L18.33 228.24L19.61 217.46L21.01 207.32L22.53 197.72L24.18 188.62L25.96 179.96L27.87 171.70L29.90 163.82L32.06 156.27L34.36 149.04L36.78 142.11L39.34 135.45L42.04 129.05L44.88 122.90L47.85 116.98L50.97 111.29L54.23 105.81L57.63 100.53L61.19 95.45L64.90 90.56L68.76 85.86L72.79 81.33L76.98 76.98L81.33 72.79L85.86 68.76L90.56 64.90L95.45 61.19L100.53 57.63L105.81 54.23L111.29 50.97L116.98 47.85L122.90 44.88L129.05 42.04L135.45 39.34L142.11 36.78L149.04 34.36L156.27 32.06L163.82 29.90L171.70 27.87L179.96 25.96L188.62 24.18L197.72 22.53L207.32 21.01L217.46 19.61L228.24 18.33L239.74 17.18L252.10 16.15L265.46 15.24L280.09 14.46L296.30 13.79L314.65 13.25L336.05 12.83L362.36 12.53L398.58 12.35L512.00 12.29L625.42 12.35L661.64 12.53L687.95 12.83L709.35 13.25L727.70 13.79L743.91 14.46L758.54 15.24L771.90 16.15L784.26 17.18L795.76 18.33L806.54 19.61L816.68 21.01L826.28 22.53L835.38 24.18L844.04 25.96L852.30 27.87L860.18 29.90L867.73 32.06L874.96 34.36L881.89 36.78L888.55 39.34L894.95 42.04L901.10 44.88L907.02 47.85L912.71 50.97L918.19 54.23L923.47 57.63L928.55 61.19L933.44 64.90L938.14 68.76L942.67 72.79L947.02 76.98L951.21 81.33L955.24 85.86L959.10 90.56L962.81 95.45L966.37 100.53L969.77 105.81L973.03 111.29L976.15 116.98L979.12 122.90L981.96 129.05L984.66 135.45L987.22 142.11L989.64 149.04L991.94 156.27L994.10 163.82L996.13 171.70L998.04 179.96L999.82 188.62L1001.47 197.72L1002.99 207.32L1004.39 217.46L1005.67 228.24L1006.82 239.74L1007.85 252.10L1008.76 265.46L1009.54 280.09L1010.21 296.30L1010.75 314.65L1011.17 336.05L1011.47 362.36L1011.65 398.58Z" fill="url(#il-mark-g)"/><path d="M1011.71 512.00L1011.65 625.42L1011.47 661.64L1011.17 687.95L1010.75 709.35L1010.21 727.70L1009.54 743.91L1008.76 758.54L1007.85 771.90L1006.82 784.26L1005.67 795.76L1004.39 806.54L1002.99 816.68L1001.47 826.28L999.82 835.38L998.04 844.04L996.13 852.30L994.10 860.18L991.94 867.73L989.64 874.96L987.22 881.89L984.66 888.55L981.96 894.95L979.12 901.10L976.15 907.02L973.03 912.71L969.77 918.19L966.37 923.47L962.81 928.55L959.10 933.44L955.24 938.14L951.21 942.67L947.02 947.02L942.67 951.21L938.14 955.24L933.44 959.10L928.55 962.81L923.47 966.37L918.19 969.77L912.71 973.03L907.02 976.15L901.10 979.12L894.95 981.96L888.55 984.66L881.89 987.22L874.96 989.64L867.73 991.94L860.18 994.10L852.30 996.13L844.04 998.04L835.38 999.82L826.28 1001.47L816.68 1002.99L806.54 1004.39L795.76 1005.67L784.26 1006.82L771.90 1007.85L758.54 1008.76L743.91 1009.54L727.70 1010.21L709.35 1010.75L687.95 1011.17L661.64 1011.47L625.42 1011.65L512.00 1011.71L398.58 1011.65L362.36 1011.47L336.05 1011.17L314.65 1010.75L296.30 1010.21L280.09 1009.54L265.46 1008.76L252.10 1007.85L239.74 1006.82L228.24 1005.67L217.46 1004.39L207.32 1002.99L197.72 1001.47L188.62 999.82L179.96 998.04L171.70 996.13L163.82 994.10L156.27 991.94L149.04 989.64L142.11 987.22L135.45 984.66L129.05 981.96L122.90 979.12L116.98 976.15L111.29 973.03L105.81 969.77L100.53 966.37L95.45 962.81L90.56 959.10L85.86 955.24L81.33 951.21L76.98 947.02L72.79 942.67L68.76 938.14L64.90 933.44L61.19 928.55L57.63 923.47L54.23 918.19L50.97 912.71L47.85 907.02L44.88 901.10L42.04 894.95L39.34 888.55L36.78 881.89L34.36 874.96L32.06 867.73L29.90 860.18L27.87 852.30L25.96 844.04L24.18 835.38L22.53 826.28L21.01 816.68L19.61 806.54L18.33 795.76L17.18 784.26L16.15 771.90L15.24 758.54L14.46 743.91L13.79 727.70L13.25 709.35L12.83 687.95L12.53 661.64L12.35 625.42L12.29 512.00L12.35 398.58L12.53 362.36L12.83 336.05L13.25 314.65L13.79 296.30L14.46 280.09L15.24 265.46L16.15 252.10L17.18 239.74L18.33 228.24L19.61 217.46L21.01 207.32L22.53 197.72L24.18 188.62L25.96 179.96L27.87 171.70L29.90 163.82L32.06 156.27L34.36 149.04L36.78 142.11L39.34 135.45L42.04 129.05L44.88 122.90L47.85 116.98L50.97 111.29L54.23 105.81L57.63 100.53L61.19 95.45L64.90 90.56L68.76 85.86L72.79 81.33L76.98 76.98L81.33 72.79L85.86 68.76L90.56 64.90L95.45 61.19L100.53 57.63L105.81 54.23L111.29 50.97L116.98 47.85L122.90 44.88L129.05 42.04L135.45 39.34L142.11 36.78L149.04 34.36L156.27 32.06L163.82 29.90L171.70 27.87L179.96 25.96L188.62 24.18L197.72 22.53L207.32 21.01L217.46 19.61L228.24 18.33L239.74 17.18L252.10 16.15L265.46 15.24L280.09 14.46L296.30 13.79L314.65 13.25L336.05 12.83L362.36 12.53L398.58 12.35L512.00 12.29L625.42 12.35L661.64 12.53L687.95 12.83L709.35 13.25L727.70 13.79L743.91 14.46L758.54 15.24L771.90 16.15L784.26 17.18L795.76 18.33L806.54 19.61L816.68 21.01L826.28 22.53L835.38 24.18L844.04 25.96L852.30 27.87L860.18 29.90L867.73 32.06L874.96 34.36L881.89 36.78L888.55 39.34L894.95 42.04L901.10 44.88L907.02 47.85L912.71 50.97L918.19 54.23L923.47 57.63L928.55 61.19L933.44 64.90L938.14 68.76L942.67 72.79L947.02 76.98L951.21 81.33L955.24 85.86L959.10 90.56L962.81 95.45L966.37 100.53L969.77 105.81L973.03 111.29L976.15 116.98L979.12 122.90L981.96 129.05L984.66 135.45L987.22 142.11L989.64 149.04L991.94 156.27L994.10 163.82L996.13 171.70L998.04 179.96L999.82 188.62L1001.47 197.72L1002.99 207.32L1004.39 217.46L1005.67 228.24L1006.82 239.74L1007.85 252.10L1008.76 265.46L1009.54 280.09L1010.21 296.30L1010.75 314.65L1011.17 336.05L1011.47 362.36L1011.65 398.58Z" fill="none" stroke="url(#il-mark-e)" strokeWidth="6.14"/><path fill="#F5F2EA" d="M319.57 679.87L228.81 770.63L253.37 795.19L344.13 704.43Z"/><path fill="#F5F2EA" d="M299.82 724.18C318.24 513.57 216.06 307.13 438.63 265.03L620.66 230.59L585.59 415.99L374.03 627.55L396.45 649.97L608.01 438.41L793.41 403.34L758.97 585.37C716.87 807.94 510.43 705.76 299.82 724.18Z"/><path fill="#7CC197" d="M654.13 224.26L799.74 369.87L620.16 403.84Z"/>
    </svg>
  );
}

/** The Ironleaf wordmark beside the space mark: the app's name in the heading face, coloured by theme. */
function BrandWordmark() {
  return <span className="wm-text">Ironleaf</span>;
}

/** A folded section behind one submenu row (shared/more-fit.ts folds the bar's rows, then the pins,
 *  only once the quiet groups cannot fit the menu in the window): the same rows, one tap deeper, so More
 *  never scrolls. Kept beside moreItems, not in it, so the eight-on-top check reads the eight first. */
function foldedSection(label: string, icon: IconName, rows: MenuItem[]): MenuItem[] {
  return [{ label, icon, submenu: rows }];
}

/** The eight on top, then the quiet second group (9 Nov 2026): Graph, Templates, Files and assets, Bookmarks,
 *  Locked, Bin, Import and Commands stay first; a thin line and small group names hold the rest (Pages, Make
 *  and open, Find, Packs and kinds). A group in foldedIds shows as one submenu row instead of its heading
 *  plus rows (shared/more-fit.ts picks biggest-first so the menu never scrolls at 709px high); everything
 *  still answers in Ctrl+K by its own name, and the bar's folded rows and the pins keep their sections above
 *  when there are any. */
function moreItems(prefs: ReturnType<typeof usePrefs>, canEdit: boolean, pinItems: MenuItem[], folded: MenuItem[], packItems: MenuItem[], kindSubmenu: MenuItem[], foldedIds: readonly string[]): MenuItem[] {
  const pagesRows: MenuItem[] = [
    ...(shows(prefs, 'ribbon:timeline') ? [{ label: 'Timeline', icon: 'timeline' as const, run: () => A.openTimeline() }] : []),
    { label: 'Shared spaces', icon: 'people', run: () => A.openSharedSpaces() },
    { label: 'People and organisations', icon: 'people', run: () => openPeople() },
    { label: 'Tags', icon: 'tag', run: () => openLife({ kind: 'tags' }) },
    { label: getAreas() ? 'Areas of life' : 'Organise by area of life…', icon: 'layers', run: () => openLife({ kind: getAreas() ? 'areas' : 'migration' }) },
    { label: 'What Ironleaf can do', icon: 'sparkle', run: () => A.openAbilities() },
  ];
  const makeRows: MenuItem[] = [
    ...(shows(prefs, 'ribbon:daily') ? [{ label: 'Daily note', icon: 'calendar' as const, hint: 'Ctrl+Shift+D', run: () => void A.openDaily() }] : []),
    ...(shows(prefs, 'ribbon:canvas') ? [{ label: 'New canvas', icon: 'canvas' as const, disabled: !canEdit, run: () => void A.newCanvas() }] : []),
    { label: 'New drawing', icon: 'pencil', disabled: !canEdit, run: () => void A.newDrawing() },
    { label: 'New view', icon: 'views', disabled: !canEdit, run: () => void import('../state/savedViews').then((v) => v.newView()) },
    { label: 'Open a file from this PC…', icon: 'file', hint: 'Ctrl+Shift+O', run: () => void A.pickLooseFiles() },
    { label: 'Import CSV…', icon: 'table', disabled: !canEdit, run: () => void import('../state/importCsv').then((m) => m.importCsv()) },
  ];
  const findRows: MenuItem[] = [
    { label: 'Search inside notes', icon: 'search', hint: 'Ctrl+Shift+F', run: () => requestSearch('') },
    ...(shows(prefs, 'ribbon:recovery') ? [{ label: 'Earlier versions of notes', icon: 'history' as const, run: () => openModal({ kind: 'recovery' }) }] : []),
  ];
  const packsRows: MenuItem[] = [
    ...packItems,
    ...(kindSubmenu.length ? [{ label: 'Other kinds', icon: 'notes' as const, submenu: kindSubmenu }] : []),
    { label: 'Choose packs…', icon: 'settings', run: () => openModal({ kind: 'settings', section: 'packs' }) },
  ];
  return [
    // The rows the bar folded away to fit the window (nav never scrolls, 3 Nov 2026) come first, as the bar had them.
    ...(folded.length ? (foldedIds.includes('bar') ? foldedSection('From the side bar', 'sidebarLeft', folded) : [{ heading: 'From the side bar' } as const, ...folded, { separator: true } as const]) : []),
    ...(pinItems.length ? (foldedIds.includes('pinned') ? foldedSection('Pinned', 'pin', pinItems) : [{ heading: 'Pinned' } as const, ...pinItems, { separator: true } as const]) : []),
    ...(shows(prefs, 'ribbon:graph') ? [{ label: 'Graph', icon: 'graph' as const, hint: 'Ctrl+G', run: () => A.openGraph() }] : []),
    ...(shows(prefs, 'ribbon:template') ? [{ label: 'Templates', icon: 'template' as const, run: () => openTemplates(currentProject()) }] : []),
    ...(shows(prefs, 'ribbon:assets') ? [{ label: 'Files and assets', icon: 'assets' as const, run: () => A.openAssets() }] : []),
    { label: 'Bookmarks', icon: 'bookmark', run: () => A.openBookmarks() },
    // The one Locked place (10.0 v2locked): private notes and secrets under one lock, one row.
    ...(shows(prefs, 'ribbon:private') ? [{ label: 'Locked', icon: 'lock' as const, run: () => A.openLocked() }] : []),
    // The bin (8.0 U13): what was deleted here, 30 days, with Restore.
    // Shown on its own too (8 Nov 2026, the quiet More): the vault's own Bin works there already.
    { label: 'Bin', icon: 'trash', run: () => A.openBin() },
    // Outside stuff in (8 Nov 2026, the quiet More): spreadsheets, Markdown files and folders of notes.
    { label: 'Import', icon: 'download', run: () => A.openImport() },
    ...(shows(prefs, 'ribbon:commands') ? [{ label: 'Commands', icon: 'command' as const, hint: 'Ctrl+K', run: () => openModal({ kind: 'palette' }) }] : []),
    { separator: true },
    // Each quiet group shows its heading plus rows, or one submenu row when folded to fit (shared/more-fit.ts).
    ...(foldedIds.includes('pages') ? [{ label: 'Pages', icon: 'notes' as const, submenu: pagesRows }] : ([{ heading: 'Pages' } as const, ...pagesRows] as MenuItem[])),
    ...(foldedIds.includes('make') ? [{ label: 'Make and open', icon: 'filePlus' as const, submenu: makeRows }] : ([{ heading: 'Make and open' } as const, ...makeRows] as MenuItem[])),
    ...(foldedIds.includes('find') ? [{ label: 'Find', icon: 'search' as const, submenu: findRows }] : ([{ heading: 'Find' } as const, ...findRows] as MenuItem[])),
    ...(foldedIds.includes('packs') ? [{ label: 'Packs and kinds', icon: 'layers' as const, submenu: packsRows }] : ([{ heading: 'Packs and kinds' } as const, ...packsRows] as MenuItem[])),
  ];
}

/** One row of the bar: where it goes, whether the person is there, and its count. The bar and the rail read it. */
export interface FrameRow {
  id: string;
  label: string;
  icon: IconName;
  title: string;
  current: boolean;
  count?: number;
  open(): void;
}

function useFrame(): { today: FrameRow; inbox: FrameRow; projects: FrameRow; tasks: FrameRow; meetings: FrameRow; meetingsOn: boolean; notes: FrameRow; people: FrameRow } {
  const ws = useWorkspace();
  const tab = activeTab(ws);
  const inbox = useInboxCount();
  // The counts, revision-fresh in one fetch (5 Nov 2026, one counting query for late, today and
  // this week, shared by Today, Tasks and the rail): Today carries its late plus today through the one
  // query on the day's own lists (project steps plus the hub's dated lines), and the same fetch names
  // the person for the foot and the headers (state/person.ts). Counts sit on Today and Inbox only
  // (5 Nov 2026, the quiet rail); the Tasks page reads its own late count itself.
  const revision = useApp((s) => s.revision);
  const [due, setDue] = useState(0);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        void Promise.all([todayData(), window.nv.hub.due().catch(() => null)]).then(
          ([d, hub]) => {
            if (!live) return;
            const now = new Date();
            const me = d.me ?? null;
            // Today's own lists (project steps plus the hub's dated lines) through the one query, read against
            // the people the vault knows (5 Nov 2026, u3 moving-in: a stranger's mention is never debt).
            setDue(sidebarTodayCount(d, hub, now));
            setPerson(me);
          },
          () => undefined,
        ),
      400,
    );
    return () => { live = false; clearTimeout(t); };
  }, [revision]);
  // One Meetings place (8.7 final polish, 30 Oct 2026, the reviewer: "Meetings shows twice in the side bar"):
  // the bar keeps its Meetings row (its settings live in Settings › Packs and the Meetings page's ⋯).
  // Off hides it (3 Nov 2026, audit f F2): the row shows only while the Meetings pack is on.
  const switches = useModules();
  const meetingsOn = moduleOn(switches, 'meetings');
  // Home folded into Today (5 Nov 2026, one morning place): a home tab is Today now, current here.
  return {
    today: { id: 'today', label: 'Today', icon: 'sun', title: 'Today', current: tab.type === 'today' || tab.type === 'home', count: due || undefined, open: () => A.openToday() },
    inbox: { id: 'inbox', label: 'Inbox', icon: 'inbox', title: 'Everything captured without a place, waiting to be filed', current: tab.type === 'inbox', count: inbox ?? undefined, open: () => openInbox() },
    projects: { id: 'projects', label: 'Projects', icon: 'layers', title: 'Projects', current: tab.type === 'projects', open: () => A.openProjects() },
    tasks: { id: 'tasks', label: 'Tasks', icon: 'task', title: 'Tasks', current: tab.type === 'tasks', open: () => A.openTasks() },
    meetings: { id: 'meetings', label: 'Meetings', icon: 'calendar', title: 'Meetings', current: tab.type === 'meetings', open: () => openMeetings() },
    meetingsOn,
    notes: { id: 'notes', label: 'Notes', icon: 'notes', title: 'Notes', current: typeOfTab(tab) === 'note', open: () => openTypePage('note') },
    people: { id: 'people', label: 'People', icon: 'people', title: 'People', current: tab.type === 'people', open: () => openPeople() },
  };
}

/** How much of the bar folds away to fit the window (3 Nov 2026: the bar scrolled with "New note"
 *  cut off; a nav panel should never scroll). The places list takes the room between New
 *  note and the foot; when its rows do not fit, the least-used fold first, each step only when the one before is not
 *  enough: 1 Notes and People move into More, 2 Tasks and Meetings move into More, 3 Projects moves into More.
 *  Today, Inbox and More never fold. Nothing is lost: every place is a row or the top of More. Short windows also
 *  set the rows closer (styles/kit.css, max-height). */
export interface BarRows { today: boolean; tasks: boolean; meetings: boolean }
export function rowsAt(level: number, b: BarRows): { rows: number; labels: number } {
  const rows = (b.today ? 1 : 0) + 1 /* Inbox */ + 1 /* Projects */ + (b.tasks ? 1 : 0) + (b.meetings ? 1 : 0) + 2 /* Notes, People */ + 1 /* More */
    - (level >= 1 ? 2 : 0) /* Notes, People */
    - (level >= 2 ? (b.tasks ? 1 : 0) + (b.meetings ? 1 : 0) : 0) /* Tasks, Meetings */
    - (level >= 3 ? 1 : 0); /* Projects */
  return { rows, labels: 0 };
}
export function foldFor(room: number, rowH: number, labelH: number, b: BarRows): number {
  void labelH;
  for (let level = 0; level < 3; level++) {
    const n = rowsAt(level, b);
    if (n.rows * rowH + n.labels * labelH <= room + 0.5) return level;
  }
  return 3;
}
function useFold(nav: RefObject<HTMLElement | null>, { today, tasks, meetings }: BarRows) {
  const [fit, setFit] = useState({ fold: 0, packSlots: 0 });
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const row = el.querySelector<HTMLElement>('.srow');
      if (!row) return;
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
      const rowH = row.offsetHeight + gap;
      const base = { today, tasks, meetings };
      const fold = foldFor(el.clientHeight, rowH, rowH, base);
      const packSlots = Math.max(0, Math.floor((el.clientHeight + gap) / rowH) - rowsAt(fold, base).rows);
      setFit({ fold, packSlots });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nav, today, tasks, meetings]);
  return fit;
}

function Row({ row }: { row: FrameRow }) {
  return (
    <button className={`srow${row.current ? ' on' : ''}`} aria-current={row.current ? 'page' : undefined} title={row.title} onClick={row.open}>
      <Icon name={row.icon} size={16} />
      <span className="clip">{row.label}</span>
      {row.count !== undefined && row.count > 0 ? <span className="n">{row.count}</span> : null}
    </button>
  );
}

export function Places({ drawer = false }: { drawer?: boolean } = {}) {
  const f = useFrame();
  const prefs = usePrefs();
  const canEdit = useApp((s) => s.canEdit);
  const bookmarks = useBookmarks();
  const pinned: MenuItem[] = bookmarks.filter((b): b is Extract<(typeof bookmarks)[number], { type: 'file' | 'folder' }> => b.type === 'file' || b.type === 'folder').slice(0, 5).map((b) => ({ label: b.title ?? (b.type === 'file' ? A.titleOf(b.path) : A.nameOf(b.path)), icon: b.type === 'folder' ? 'folder' as const : 'pin' as const, run: () => A.openPath(b.path) }));
  // Meetings already has its own row. Other packs switched on share the space left by the core places.
  const packsOn = modulesOn(useModules()).filter((m) => m.id !== 'meetings');
  const hereTab = activeTab(useWorkspace());
  const hereModule = hereTab.type === 'meetings' ? 'meetings' : moduleOfTab(hereTab);
  // Every other kind (the bar's own Projects, Meetings, People and Notes left out) in one submenu, full or empty.
  const otherKinds = useShellTypes().filter((t) => !['project', 'meeting', 'person', 'note'].includes(t.id));
  const kindSubmenu: MenuItem[] = otherKinds.map((t): MenuItem => ({ label: t.plural, icon: t.icon, hint: t.count > 0 ? String(t.count) : undefined, run: t.open }));
  const showToday = shows(prefs, 'ribbon:today');
  const showTasks = shows(prefs, 'ribbon:tasks');
  const navRef = useRef<HTMLElement>(null);
  const { fold, packSlots } = useFold(navRef, { today: showToday, tasks: showTasks, meetings: f.meetingsOn });
  const packRows: FrameRow[] = packsOn.map((m) => ({
    id: m.id, label: m.name, icon: m.icon as IconName, title: m.words,
    current: hereModule === m.id, open: () => openModule(m.id),
  }));
  // What folded away, as More's first rows, in the bar's order; the place the person is on shows as More on.
  const asItem = (r: FrameRow): MenuItem => ({ label: r.label, icon: r.icon, hint: r.count ? String(r.count) : undefined, checked: r.current || undefined, run: r.open });
  const overflow = packRows.slice(packSlots);
  const packItems = packRows.map(asItem);
  const folded: MenuItem[] = [
    ...(fold >= 3 ? [asItem(f.projects)] : []),
    ...(fold >= 2 ? [...(showTasks ? [asItem(f.tasks)] : []), ...(f.meetingsOn ? [asItem(f.meetings)] : [])] : []),
    ...(fold >= 1 ? [asItem(f.notes), asItem(f.people)] : []),
  ];
  const foldedHere = overflow.some((p) => p.current) || (fold >= 3 && f.projects.current) || (fold >= 2 && ((showTasks && f.tasks.current) || (f.meetingsOn && f.meetings.current))) || (fold >= 1 && (f.notes.current || f.people.current));
  // What More shows (visible rows only): the eight, then the four quiet groups for the fold math to count.
  const eightShown = 3 + (shows(prefs, 'ribbon:graph') ? 1 : 0) + (shows(prefs, 'ribbon:template') ? 1 : 0) + (shows(prefs, 'ribbon:assets') ? 1 : 0) + (shows(prefs, 'ribbon:private') ? 1 : 0) + (shows(prefs, 'ribbon:commands') ? 1 : 0);
  const pagesShown = 5 + (shows(prefs, 'ribbon:timeline') ? 1 : 0);
  const makeShown = 4 + (shows(prefs, 'ribbon:daily') ? 1 : 0) + (shows(prefs, 'ribbon:canvas') ? 1 : 0);
  const findShown = 1 + (shows(prefs, 'ribbon:recovery') ? 1 : 0);
  const packsShown = packItems.length + (kindSubmenu.length ? 1 : 0) + 1;
  const moreGroups = [{ id: 'pages', rows: pagesShown }, { id: 'make', rows: makeShown }, { id: 'find', rows: findShown }, { id: 'packs', rows: packsShown }];
  // More's measured fit (9 Nov 2026, "Choose packs…" cut off at 1920x1117: the estimate misses the menu's top
  // and border). The pure estimate opens first; then the real menu is measured and the next biggest group folds
  // until its bottom sits 8px above the window's with no scroll, one frame at a time so the menu's own placing
  // lands first. Only More refolds (its quiet group names say so); a submenu open or another menu stays alone.
  const fitMore = (anchor: HTMLElement, foldedIds: readonly string[]): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const menus = document.querySelectorAll('.menu');
      if (menus.length !== 1) return;
      const menu = menus[0] as HTMLElement;
      if (!menu.textContent?.includes('Packs and kinds') && !menu.textContent?.includes('Choose packs')) return;
      // The layout bottom, not the rect (the settle animation scales the rect smaller while it runs).
      const top = Number.parseFloat(menu.style.top);
      const bottom = (Number.isFinite(top) ? top : menu.getBoundingClientRect().top) + menu.offsetHeight;
      if (bottom <= window.innerHeight - 8 + 0.5 && menu.scrollHeight - menu.clientHeight <= 1) return;
      // The bar's rows and the pins fold in the estimate only (moreFoldToFit), where a last resort counts only when
      // it makes the menu fit; the measured loop refolds the four groups.
      const next = nextMoreFold(moreGroups, foldedIds);
      if (!next) return;
      const ids = [...foldedIds, next];
      openMenu(anchor, moreItems(prefs, canEdit, pinned, folded, packItems, kindSubmenu, ids));
      fitMore(anchor, ids);
    }));
  };
  const openMore = (anchor: HTMLElement): void => {
    const foldedIds = moreFoldToFit({ available: window.innerHeight - 8 - minPopupTop(), pinned: pinned.length, folded: folded.length, eight: eightShown, groups: moreGroups });
    openMenu(anchor, moreItems(prefs, canEdit, pinned, folded, packItems, kindSubmenu, foldedIds));
    fitMore(anchor, foldedIds);
  };
  return (
    <>
      <div className="vault" title="Double-click to fold the bar to icons" onDoubleClick={() => { closeMenu(); setRail(true); }}>
        <span className="mark" aria-hidden="true"><VaultMark size={38} /></span>
        <div className="brand-words">
          <BrandWordmark />
        </div>
        <button className="places-hide" title={drawer ? 'Close (Esc)' : 'Hide the left side'} aria-label="Hide the left side" onClick={() => hideSide('left')}>
          <Icon name="sidebarLeft" size={16} />
        </button>
      </div>
      <button className="btn pri places-action" disabled={!canEdit} onClick={(e) => openNewDoor(e.currentTarget)}>
        <Icon name="plus" size={16} />
        <span>New</span>
      </button>
      <nav className="places-list" aria-label="Places" ref={navRef} data-fold={fold}>
        {showToday && <Row row={f.today} />}
        <Row row={f.inbox} />
        {fold < 3 && <Row row={f.projects} />}
        {showTasks && fold < 2 && <Row row={f.tasks} />}
        {f.meetingsOn && fold < 2 && <Row row={f.meetings} />}
        {fold < 1 && <Row row={f.notes} />}
        {fold < 1 && <Row row={f.people} />}
        {packRows.slice(0, packSlots).map((row) => <Row key={row.id} row={row} />)}
        {/* More is a plain row (9 Nov 2026, the rows back): the eight on top, the quiet groups behind them. */}
        <button className={`srow${foldedHere ? ' on' : ''}`} aria-haspopup="menu" title="Graph, Templates, Files and assets, Bookmarks, Locked, Bin, Import, Commands and more" onClick={(e) => openMore(e.currentTarget)}>
          <Icon name="more" size={16} />
          <span className="clip">More</span>
        </button>
      </nav>
    </>
  );
}

/** The folded bar (frame-collapsed.png): the same places as icons, with words on hover and a dot for waiting Inbox.
 *  Its foot is the account's avatar (the same menu as the open bar's foot), then the bell. */
export function Rail() {
  const f = useFrame();
  const vault = useApp((s) => s.vault);
  const showTasks = shows(usePrefs(), 'ribbon:tasks');
  const hereModule = moduleOfTab(activeTab(useWorkspace()));
  const packs = modulesOn(useModules()).filter((m) => m.id !== 'meetings');
  const rows = [f.today, f.inbox, f.projects, ...(showTasks ? [f.tasks] : []), ...(f.meetingsOn ? [f.meetings] : []), f.notes, f.people];
  // The hover tip names the row (8.7 wave 1 polish, 30 Oct 2026, frame-collapsed.png's "Inbox · 3 waiting").
  const tipOf = (row: FrameRow) => (row.count ? `${row.label} · ${row.count}${row.id === 'inbox' ? ' waiting' : ''}` : row.label);
  return (
    <>
      <button className="mark" title={`${vault?.name ?? 'Ironleaf'} · click to unfold the bar`} aria-label="Unfold the side bar" onClick={() => setRail(false)}>
        <VaultMark size={30} />
      </button>
      {rows.map((row) => (
        <button key={row.id} className={`rrow${row.current ? ' on' : ''}`} aria-current={row.current ? 'page' : undefined} aria-label={tipOf(row)} onClick={row.open}>
          <Icon name={row.icon} size={18} />
          {row.id === 'inbox' && (row.count ?? 0) > 0 && <span className="dot" aria-hidden="true" />}
          <span className="tip" aria-hidden="true">{tipOf(row)}</span>
        </button>
      ))}
      {packs.length > 0 && (
        <button className={packs.some((m) => m.id === hereModule) ? 'rrow on' : 'rrow'} aria-label="Packs" aria-haspopup="menu"
          onClick={(e) => openMenu(e.currentTarget, packs.map((m) => ({
            label: m.name, icon: m.icon as IconName, checked: m.id === hereModule || undefined, run: () => openModule(m.id),
          })))}>
          <Icon name="layers" size={18} />
          <span className="tip" aria-hidden="true">Packs</span>
        </button>
      )}
      <div className="sp" />
      <AccountChip variant="rail" />
      <NoticeBell />
    </>
  );
}

/** The foot of the bar (20 Nov 2026): one account row, as the account chip in VS Code, Slack or Linear, with the bell at
 *  its right. The row is the avatar (the update dot on it), the person's name and their plan, or "Sign in" and why it
 *  is optional; it opens the one menu that holds the account, Settings and About and updates
 *  (components/account/AccountMenu.tsx). Settings and the version are no longer rows of their own here. */
export function PlacesFoot() {
  return (
    <div className="places-foot">
      <div className="places-profile">
        <AccountChip variant="foot" />
        <NoticeBell />
      </div>
    </div>
  );
}
