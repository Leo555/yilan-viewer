/* 环形缓冲区：固定容量，满了以后覆盖最旧的数据 */
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RING_CAPACITY 8

typedef struct {
    int data[RING_CAPACITY];
    size_t head;  /* 下一个写入位置 */
    size_t count;
} ring_t;

static void ring_push(ring_t *r, int value)
{
    r->data[r->head] = value;
    r->head = (r->head + 1) % RING_CAPACITY;
    if (r->count < RING_CAPACITY)
        r->count++;
}

static bool ring_pop(ring_t *r, int *out)
{
    if (r->count == 0)
        return false;
    size_t tail = (r->head + RING_CAPACITY - r->count) % RING_CAPACITY;
    *out = r->data[tail];
    r->count--;
    return true;
}

int main(int argc, char **argv)
{
    ring_t ring;
    memset(&ring, 0, sizeof ring);

    int n = argc > 1 ? atoi(argv[1]) : 12;
    for (int i = 1; i <= n; i++)
        ring_push(&ring, i * i);

    printf("保留最近 %zu 个：", ring.count);
    int v;
    while (ring_pop(&ring, &v))
        printf("%d ", v);
    putchar('\n');
    return EXIT_SUCCESS;
}
