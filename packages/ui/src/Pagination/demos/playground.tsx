import { Pagination } from "../index.js";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";

export default function PaginationPlayground() {
  const controls = useControls({
    page: {
      min: 1,
      max: 24,
      step: 1,
      value: 1,
    },
    total: {
      min: 1,
      max: 240,
      step: 1,
      value: 30,
    },
    pageSize: {
      min: 1,
      max: 50,
      step: 1,
      value: 10,
    },
    siblingCount: {
      min: 0,
      max: 2,
      step: 1,
      value: 1,
    },
    disabled: false,
  });
  const setControl = useSetControl();

  return (
    <StoryBook>
      <Pagination
        disabled={controls.disabled}
        onPageChange={(nextPage) => setControl("page", nextPage)}
        page={controls.page}
        pageSize={controls.pageSize}
        siblingCount={controls.siblingCount}
        total={controls.total}
      />
    </StoryBook>
  );
}
