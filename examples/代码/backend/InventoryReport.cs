using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Demo.Inventory;

public enum Category { Book, Electronics, Food }

public record Product(int Id, string Name, Category Category, decimal Price, int Stock);

public interface IProductRepository
{
    Task<IReadOnlyList<Product>> GetAllAsync();
}

public sealed class InventoryReport(IProductRepository repo)
{
    public async Task<string> BuildAsync(decimal lowStockThreshold = 5)
    {
        var products = await repo.GetAllAsync();

        var summary = products
            .GroupBy(p => p.Category)
            .Select(g => new
            {
                Category = g.Key,
                Count = g.Count(),
                Value = g.Sum(p => p.Price * p.Stock),
            })
            .OrderByDescending(x => x.Value);

        var lines = new List<string> { $"{"分类",-12}{"数量",6}{"库存价值",14}" };
        lines.AddRange(summary.Select(s => $"{s.Category,-12}{s.Count,6}{s.Value,14:C}"));

        var lowStock = products.Where(p => p.Stock < lowStockThreshold).Select(p => p.Name).ToArray();
        if (lowStock is { Length: > 0 })
        {
            lines.Add($"库存不足：{string.Join("、", lowStock)}");
        }
        return string.Join(Environment.NewLine, lines);
    }
}
