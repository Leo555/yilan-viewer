#include <algorithm>
#include <chrono>
#include <iostream>
#include <list>
#include <optional>
#include <string>
#include <unordered_map>

// LRU 缓存：O(1) 读写
template <typename K, typename V>
class LruCache {
public:
    explicit LruCache(std::size_t capacity) : capacity_(capacity) {}

    std::optional<V> get(const K& key) {
        auto it = index_.find(key);
        if (it == index_.end()) return std::nullopt;
        items_.splice(items_.begin(), items_, it->second);
        return it->second->second;
    }

    void put(const K& key, V value) {
        if (auto it = index_.find(key); it != index_.end()) {
            it->second->second = std::move(value);
            items_.splice(items_.begin(), items_, it->second);
            return;
        }
        if (items_.size() == capacity_) {
            index_.erase(items_.back().first);
            items_.pop_back();
        }
        items_.emplace_front(key, std::move(value));
        index_[key] = items_.begin();
    }

    [[nodiscard]] std::size_t size() const noexcept { return items_.size(); }

private:
    using Item = std::pair<K, V>;
    std::size_t capacity_;
    std::list<Item> items_;
    std::unordered_map<K, typename std::list<Item>::iterator> index_;
};

int main() {
    using namespace std::chrono;
    LruCache<std::string, int> cache(2);
    cache.put("a", 1);
    cache.put("b", 2);
    cache.get("a");
    cache.put("c", 3);  // 淘汰 b

    for (const auto* key : {"a", "b", "c"}) {
        auto v = cache.get(key);
        std::cout << key << " -> " << (v ? std::to_string(*v) : "miss") << '\n';
    }

    const auto start = steady_clock::now();
    LruCache<int, int> big(1'000);
    for (int i = 0; i < 1'000'000; ++i) big.put(i % 1'500, i);
    std::cout << "耗时 " << duration_cast<milliseconds>(steady_clock::now() - start).count() << " ms\n";
}
