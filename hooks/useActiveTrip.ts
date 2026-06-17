import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/config/firebase';

export interface MarkerDef {
  id: string;
  type: 'pickup' | 'dropoff' | 'stop' | 'store';
  lat: number;
  lng: number;
}

export type WorkflowType = 'direct_trip' | 'store_delivery';

interface UseActiveTripResult {
  activeTrip: any | null;
  tripStatus: string | null;
  workflowType: WorkflowType | null;
  polylineToPickup: string | null;
  polylineToDestination: string | null;
  markers: MarkerDef[];
  showPolyline: boolean;
  activePolyline: string | null;
}

// Read a coordinate that may be stored in several shapes:
// order.pickupLocation.latitude/longitude OR order.pickupLat/pickupLng
function readCoord(
  order: any,
  objKey: string,
  latKey: string,
  lngKey: string
): { lat: number; lng: number } | null {
  if (!order) return null;

  const obj = order[objKey];
  if (obj && typeof obj.latitude === 'number' && typeof obj.longitude === 'number') {
    return { lat: obj.latitude, lng: obj.longitude };
  }
  if (obj && typeof obj.lat === 'number' && typeof obj.lng === 'number') {
    return { lat: obj.lat, lng: obj.lng };
  }
  if (typeof order[latKey] === 'number' && typeof order[lngKey] === 'number') {
    return { lat: order[latKey], lng: order[lngKey] };
  }
  return null;
}

function buildStopMarkers(order: any): MarkerDef[] {
  const stops = Array.isArray(order?.stops) ? order.stops : [];
  const markers: MarkerDef[] = [];
  stops.forEach((stop: any, index: number) => {
    let lat: number | null = null;
    let lng: number | null = null;
    if (stop?.location && typeof stop.location.latitude === 'number') {
      lat = stop.location.latitude;
      lng = stop.location.longitude;
    } else if (typeof stop?.latitude === 'number') {
      lat = stop.latitude;
      lng = stop.longitude;
    } else if (typeof stop?.lat === 'number') {
      lat = stop.lat;
      lng = stop.lng;
    }
    if (lat != null && lng != null) {
      markers.push({ id: `stop-${index + 1}`, type: 'stop', lat, lng });
    }
  });
  return markers;
}

export function useActiveTrip(driverId: string | null): UseActiveTripResult {
  const [activeTrip, setActiveTrip] = useState<any | null>(null);

  useEffect(() => {
    if (!driverId) {
      setActiveTrip(null);
      return;
    }

    // Same query pattern used elsewhere: orders for this driver that aren't completed
    const ordersRef = collection(firestore, 'orders');
    const q = query(
      ordersRef,
      where('driverId', '==', driverId),
      where('status', '!=', 'completed')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setActiveTrip(null);
          return;
        }
        // Pick the first active (non-terminal) order
        const terminal = ['completed', 'cancelled', 'rejected', 'expired'];
        const docSnap = snapshot.docs.find(
          (d) => !terminal.includes((d.data() as any).status)
        );
        if (docSnap) {
          setActiveTrip({ id: docSnap.id, ...docSnap.data() });
        } else {
          setActiveTrip(null);
        }
      },
      (error) => {
        console.log('[v0] useActiveTrip snapshot error:', error.message);
        setActiveTrip(null);
      }
    );

    return () => unsubscribe();
  }, [driverId]);

  const tripStatus: string | null = activeTrip?.status ?? null;
  const workflowType: WorkflowType | null = activeTrip?.workflowType ?? null;
  const polylineToPickup: string | null = activeTrip?.polylineToPickup ?? null;
  const polylineToDestination: string | null = activeTrip?.polylineToDestination ?? null;

  // Compute markers and active polyline based on status + workflow
  let markers: MarkerDef[] = [];
  let activePolyline: string | null = null;

  if (activeTrip && tripStatus && workflowType) {
    const pickup = readCoord(activeTrip, 'pickupLocation', 'pickupLat', 'pickupLng');
    const dropoff = readCoord(activeTrip, 'destinationLocation', 'dropLat', 'dropLng');
    const store = readCoord(activeTrip, 'storeLocation', 'storeLat', 'storeLng') || pickup;
    const stopMarkers = buildStopMarkers(activeTrip);

    if (workflowType === 'direct_trip') {
      switch (tripStatus) {
        case 'accepted':
          activePolyline = polylineToPickup;
          if (pickup) markers = [{ id: 'pickup', type: 'pickup', lat: pickup.lat, lng: pickup.lng }];
          break;
        case 'arrived':
          activePolyline = null;
          markers = [];
          break;
        case 'started':
          activePolyline = polylineToDestination;
          markers = [
            ...(dropoff ? [{ id: 'dropoff', type: 'dropoff' as const, lat: dropoff.lat, lng: dropoff.lng }] : []),
            ...stopMarkers,
          ];
          break;
        case 'completed':
        default:
          activePolyline = null;
          markers = [];
          break;
      }
    } else if (workflowType === 'store_delivery') {
      switch (tripStatus) {
        case 'accepted':
          activePolyline = polylineToPickup;
          if (store) markers = [{ id: 'store', type: 'store', lat: store.lat, lng: store.lng }];
          break;
        case 'at_store':
          activePolyline = null;
          markers = [];
          break;
        case 'picked_up':
          activePolyline = polylineToDestination;
          markers = [
            ...(dropoff ? [{ id: 'dropoff', type: 'dropoff' as const, lat: dropoff.lat, lng: dropoff.lng }] : []),
            ...stopMarkers,
          ];
          break;
        case 'delivered':
        case 'completed':
        default:
          activePolyline = null;
          markers = [];
          break;
      }
    }
  }

  const showPolyline = activePolyline != null;

  return {
    activeTrip,
    tripStatus,
    workflowType,
    polylineToPickup,
    polylineToDestination,
    markers,
    showPolyline,
    activePolyline,
  };
}
