use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use settings_benchmarks::{
    build_workload, materialize_diff, materialize_presentation, scan_effective_values,
};
use std::hint::black_box;

fn settings_hot_paths(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("settings_hot_paths");

    for size in [100usize, 1_000, 5_000] {
        let workload = build_workload(size, 100);
        group.throughput(Throughput::Elements(size as u64));

        group.bench_with_input(BenchmarkId::new("effective_scan", size), &size, |bencher, _| {
            bencher.iter(|| black_box(scan_effective_values(black_box(&workload))));
        });
        group.bench_with_input(BenchmarkId::new("sparse_diff", size), &size, |bencher, _| {
            bencher.iter(|| black_box(materialize_diff(black_box(&workload))));
        });
        group.bench_with_input(
            BenchmarkId::new("presentation_materialization", size),
            &size,
            |bencher, _| {
                bencher.iter(|| black_box(materialize_presentation(black_box(&workload))));
            },
        );
    }

    group.finish();
}

criterion_group!(benches, settings_hot_paths);
criterion_main!(benches);
