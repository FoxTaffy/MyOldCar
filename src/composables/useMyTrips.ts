import { computed } from 'vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import type { Trip } from '@/services/TripRecorder'

/** Поездки активной машины; демо-поездки видны только в демо-режиме и в статистику реальной машины не идут. */
export function useMyTrips() {
  const { garage } = useGarage()
  const { prefs } = useVehicle()
  const demo = computed(() => prefs.mode === 'mock')
  const trips = computed<Trip[]>(() => garage.trips.filter((t) => (!t.carId || t.carId === garage.activeCarId) && !!t.demo === demo.value))
  return { trips, demo, since: (days: number): Trip[] => trips.value.filter((t) => t.start >= Date.now() - days * 86400000) }
}
