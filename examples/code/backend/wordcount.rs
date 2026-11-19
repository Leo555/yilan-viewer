use std::collections::HashMap;
use std::fmt;
use std::io::{self, BufRead};

/// 统计标准输入中每个单词出现的次数，输出前 N 个。
#[derive(Debug, Default)]
struct WordCount {
    counts: HashMap<String, usize>,
    total: usize,
}

impl WordCount {
    fn feed(&mut self, line: &str) {
        for word in line
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
        {
            *self.counts.entry(word.to_lowercase()).or_insert(0) += 1;
            self.total += 1;
        }
    }

    fn top(&self, n: usize) -> Vec<(&str, usize)> {
        let mut v: Vec<_> = self.counts.iter().map(|(k, &c)| (k.as_str(), c)).collect();
        v.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        v.truncate(n);
        v
    }
}

impl fmt::Display for WordCount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "共 {} 个单词，{} 个不同", self.total, self.counts.len())?;
        for (i, (word, count)) in self.top(10).into_iter().enumerate() {
            writeln!(f, "{:>2}. {:<16} {}", i + 1, word, count)?;
        }
        Ok(())
    }
}

fn main() -> io::Result<()> {
    let mut wc = WordCount::default();
    for line in io::stdin().lock().lines() {
        wc.feed(&line?);
    }
    print!("{wc}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_words_case_insensitively() {
        let mut wc = WordCount::default();
        wc.feed("Hello, hello world!");
        assert_eq!(wc.top(1), vec![("hello", 2)]);
    }
}
