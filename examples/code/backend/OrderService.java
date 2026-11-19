package com.example.order;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * 订单服务：演示 record、sealed 接口、switch 模式匹配和 Stream。
 */
public final class OrderService {

    public sealed interface Discount permits Percent, Fixed, None {}
    public record Percent(int value) implements Discount {}
    public record Fixed(BigDecimal amount) implements Discount {}
    public record None() implements Discount {}

    public record Item(String sku, int qty, BigDecimal price) {
        public BigDecimal subtotal() {
            return price.multiply(BigDecimal.valueOf(qty));
        }
    }

    public record Order(long id, String user, List<Item> items, Discount discount, LocalDateTime createdAt) {}

    private final Map<Long, Order> orders;

    public OrderService(Map<Long, Order> orders) {
        this.orders = orders;
    }

    public Optional<BigDecimal> total(long orderId) {
        return Optional.ofNullable(orders.get(orderId)).map(order -> {
            BigDecimal sum = order.items().stream()
                    .map(Item::subtotal)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            return switch (order.discount()) {
                case Percent p -> sum.multiply(BigDecimal.valueOf(100 - p.value())).movePointLeft(2);
                case Fixed f -> sum.subtract(f.amount()).max(BigDecimal.ZERO);
                case None n -> sum;
            };
        });
    }

    public Map<String, Long> countByUser() {
        return orders.values().stream()
                .collect(Collectors.groupingBy(Order::user, Collectors.counting()));
    }

    @Override
    public String toString() {
        return "OrderService[%d orders]".formatted(orders.size());
    }
}
