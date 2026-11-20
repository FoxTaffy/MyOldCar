<script setup lang="ts">
import {
  Activity, ArrowLeftRight, Battery, Bell, BookOpen, Bluetooth, Camera, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, CircleHelp, Cog, Download, Droplet, Fuel, Gauge, GripVertical, House, Info, Leaf, List, Lock, MapPin,
  MessageCircleQuestion, Menu, Minus, Moon, MoonStar, Pencil, Plug, Plus, RefreshCw, Route, Scan, ScanSearch, Settings, Share,
  Shield, ShieldCheck, ShipWheel, ShowerHead, SquareParking, Sun, Thermometer, Timer, Trash2, TriangleAlert, User, Wallet, Wifi, Wrench, X,
  CarFront,
} from 'lucide-vue-next'

/** Значки Lucide (ISC), цвет — currentColor. Имена — прежние, поэтому экраны не менялись. */
defineProps<{ name: string; size?: number }>()
const ICONS = {
  home: House, menu: Menu, back: ChevronLeft, chevron: ChevronRight, down: ChevronDown, up: ChevronUp, close: X, plus: Plus, minus: Minus,
  check: Check, trash: Trash2, edit: Pencil, help: CircleHelp, info: Info, gear: Settings, monitor: Activity, carsearch: ScanSearch,
  car: CarFront, gauge: Gauge, route: Route, wheel: ShipWheel, pump: Fuel, leaf: Leaf, faq: MessageCircleQuestion, book: BookOpen,
  engine: Cog, stopwatch: Timer, hud: Scan, parking: SquareParking, bluetooth: Bluetooth, wifi: Wifi, warn: TriangleAlert, drop: Droplet,
  shower: ShowerHead, wrench: Wrench, pin: MapPin, shield: Shield, shieldcheck: ShieldCheck, chart: ChartColumn, download: Download,
  share: Share, plug: Plug, lock: Lock, user: User, drag: GripVertical, moon: Moon, sun: Sun, battery: Battery, therm: Thermometer,
  moonstar: MoonStar, wallet: Wallet, bell: Bell, camera: Camera, refresh: RefreshCw, list: List, swap: ArrowLeftRight,
} as const
</script>

<template>
  <component :is="ICONS[name as keyof typeof ICONS] ?? Info" :size="size ?? 24" :stroke-width="1.75" aria-hidden="true" />
</template>
