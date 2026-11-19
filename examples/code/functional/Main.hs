module Main where

import Data.Char (isSpace)
import Data.List (sortOn)
import qualified Data.Map.Strict as Map

-- | 简单的表达式解析与求值
data Expr
  = Num Double
  | Add Expr Expr
  | Mul Expr Expr
  | Neg Expr
  deriving (Show, Eq)

eval :: Expr -> Double
eval (Num n) = n
eval (Add a b) = eval a + eval b
eval (Mul a b) = eval a * eval b
eval (Neg e) = negate (eval e)

-- | 词频统计
wordFreq :: String -> [(String, Int)]
wordFreq = take 5 . sortOn (negate . snd) . Map.toList . Map.fromListWith (+) . map (,1) . words

quicksort :: Ord a => [a] -> [a]
quicksort [] = []
quicksort (p : xs) = quicksort [x | x <- xs, x < p] ++ [p] ++ quicksort [x | x <- xs, x >= p]

trim :: String -> String
trim = f . f where f = reverse . dropWhile isSpace

main :: IO ()
main = do
  print $ eval (Add (Num 1) (Mul (Num 2) (Neg (Num 3))))
  print $ quicksort [3, 1, 4, 1, 5, 9, 2, 6 :: Int]
  mapM_ print $ wordFreq "the quick brown fox jumps over the lazy dog the end"
  putStrLn $ trim "   hello haskell   "
