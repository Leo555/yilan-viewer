# 鸢尾花数据集：描述统计 + 线性回归 + 作图
library(dplyr)
library(ggplot2)

data(iris)

summary_tbl <- iris %>%
  group_by(Species) %>%
  summarise(
    n = n(),
    sepal_mean = mean(Sepal.Length),
    petal_mean = mean(Petal.Length),
    .groups = "drop"
  ) %>%
  arrange(desc(petal_mean))

print(summary_tbl)

model <- lm(Petal.Width ~ Petal.Length, data = iris)
cat(sprintf("R² = %.3f\n", summary(model)$r.squared))

p <- ggplot(iris, aes(Petal.Length, Petal.Width, colour = Species)) +
  geom_point(alpha = 0.7) +
  geom_smooth(method = "lm", se = FALSE, colour = "grey40") +
  labs(title = "花瓣长度与宽度", x = "长度 (cm)", y = "宽度 (cm)") +
  theme_minimal()

ggsave("petal.png", p, width = 6, height = 4, dpi = 150)
