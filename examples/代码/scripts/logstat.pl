#!/usr/bin/env perl
# 解析 Nginx 访问日志，统计状态码和 Top IP
use strict;
use warnings;
use utf8;

my (%status, %ip);
my $total = 0;

while (my $line = <>) {
    next unless $line =~ m{^(\S+) \S+ \S+ \[[^\]]+\] "(?:GET|POST|PUT|DELETE|HEAD) [^"]*" (\d{3}) };
    my ($addr, $code) = ($1, $2);
    $status{$code}++;
    $ip{$addr}++;
    $total++;
}

die "没有匹配的日志行\n" unless $total;

binmode STDOUT, ':encoding(UTF-8)';
printf "共 %d 条请求\n\n状态码：\n", $total;
printf "  %s  %6d  %5.1f%%\n", $_, $status{$_}, 100 * $status{$_} / $total
    for sort keys %status;

print "\nTop 5 IP：\n";
my @top = (sort { $ip{$b} <=> $ip{$a} } keys %ip)[0 .. 4];
printf "  %-15s %d\n", $_, $ip{$_} for grep { defined } @top;
