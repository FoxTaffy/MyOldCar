<script setup lang="ts">
import {
  Activity, ArrowLeftRight, Battery, Bell, BookOpen, Bluetooth, Camera, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, CircleHelp, Download, Droplet, Fuel, Gauge, GripVertical, House, Info, Leaf, List, Lock, MapPin,
  MessageCircleQuestion, Menu, Minus, Moon, MoonStar, Pencil, Plug, Plus, RefreshCw, Route, Scan, ScanSearch, Settings, Share,
  Shield, ShieldCheck, ShowerHead, SquareParking, Sun, Thermometer, Timer, Trash2, TriangleAlert, User, Wallet, Wifi, Wrench, X,
  CarFront, FileText, Receipt, CalendarClock, Signpost, FileDown, Package,
} from 'lucide-vue-next'

/** Значки Lucide (ISC), цвет — currentColor. Имена — прежние, поэтому экраны не менялись. */
defineProps<{ name: string; size?: number }>()
/** Значков руля и двигателя в Lucide нет — они нарисованы в той же сетке 24×24, штрих 1.75. */
const CUSTOM: Record<string, string> = {
  wheel: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 14.2a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4zM3.4 10.4c2.7.3 5 .7 6.4 1.4M20.6 10.4c-2.7.3-5 .7-6.4 1.4M12 14.2V20.6',
  engine: 'M7 7h8v2h2.5l1.5 2h2v5h-2l-1.5 2H8L6 16H3v-5h3zM9.5 7V4.5h4V7M3 13.5H1.5M12 11.5v3',
}
const ICONS = {
  home: House, menu: Menu, back: ChevronLeft, chevron: ChevronRight, down: ChevronDown, up: ChevronUp, close: X, plus: Plus, minus: Minus,
  check: Check, trash: Trash2, edit: Pencil, help: CircleHelp, info: Info, gear: Settings, monitor: Activity, carsearch: ScanSearch,
  car: CarFront, gauge: Gauge, route: Route, pump: Fuel, leaf: Leaf, faq: MessageCircleQuestion, book: BookOpen,
  stopwatch: Timer, hud: Scan, parking: SquareParking, bluetooth: Bluetooth, wifi: Wifi, warn: TriangleAlert, drop: Droplet,
  shower: ShowerHead, wrench: Wrench, pin: MapPin, shield: Shield, shieldcheck: ShieldCheck, chart: ChartColumn, download: Download,
  share: Share, plug: Plug, lock: Lock, user: User, drag: GripVertical, moon: Moon, sun: Sun, battery: Battery, therm: Thermometer,
  moonstar: MoonStar, wallet: Wallet, bell: Bell, camera: Camera, refresh: RefreshCw, list: List, swap: ArrowLeftRight,
  doc: FileText, receipt: Receipt, calendar: CalendarClock, road: Signpost, export: FileDown, box: Package,
} as const
</script>

<template>
  <svg v-if="CUSTOM[name]" viewBox="0 0 24 24" :width="size ?? 24" :height="size ?? 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="CUSTOM[name]" /></svg>
  <component v-else :is="ICONS[name as keyof typeof ICONS] ?? Info" :size="size ?? 24" :stroke-width="1.75" aria-hidden="true" />
</template>
