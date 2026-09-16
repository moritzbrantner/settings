use serde_json::json;
use settings_benchmarks::{
    build_workload, materialize_diff, materialize_presentation, scan_effective_values,
};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct CountingAllocator;

static ALLOCATION_CALLS: AtomicUsize = AtomicUsize::new(0);
static REQUESTED_BYTES: AtomicUsize = AtomicUsize::new(0);

#[global_allocator]
static GLOBAL_ALLOCATOR: CountingAllocator = CountingAllocator;

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        REQUESTED_BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        REQUESTED_BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        REQUESTED_BYTES.fetch_add(new_size, Ordering::Relaxed);
        unsafe { System.realloc(pointer, layout, new_size) }
    }
}

struct Measurement<T> {
    value: T,
    allocation_calls: usize,
    requested_bytes: usize,
}

fn measure<T>(operation: impl FnOnce() -> T) -> Measurement<T> {
    ALLOCATION_CALLS.store(0, Ordering::Relaxed);
    REQUESTED_BYTES.store(0, Ordering::Relaxed);
    let value = operation();
    Measurement {
        value,
        allocation_calls: ALLOCATION_CALLS.load(Ordering::Relaxed),
        requested_bytes: REQUESTED_BYTES.load(Ordering::Relaxed),
    }
}

fn main() {
    let registry_size = 1_000usize;
    let workload = build_workload(registry_size, 100);

    let effective_scan = measure(|| scan_effective_values(&workload));
    let sparse_diff = measure(|| materialize_diff(&workload));
    let presentation = measure(|| materialize_presentation(&workload));

    let evidence = json!({
        "schema_version": 1,
        "workload": {
            "registry_size": registry_size,
            "changed_settings": sparse_diff.value.len(),
            "effective_true_values": effective_scan.value,
            "presentation_entries": presentation.value.len()
        },
        "measurements": {
            "effective_scan": {
                "allocation_calls": effective_scan.allocation_calls,
                "requested_bytes": effective_scan.requested_bytes
            },
            "sparse_diff": {
                "allocation_calls": sparse_diff.allocation_calls,
                "requested_bytes": sparse_diff.requested_bytes
            },
            "presentation_materialization": {
                "allocation_calls": presentation.allocation_calls,
                "requested_bytes": presentation.requested_bytes
            }
        },
        "interpretation": "Evidence only: CI records allocation requests but does not gate on allocator-specific counts or timing."
    });

    println!("{}", serde_json::to_string_pretty(&evidence).unwrap());
}
